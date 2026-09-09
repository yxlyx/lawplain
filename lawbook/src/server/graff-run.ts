/**
 * Step-wise graff run, designed to be driven by a Durable Object: `launch()`
 * once (create sandbox + start graff), then `poll()` repeatedly (read new
 * stdout, emit normalized AgentEvents) until `done`. Unlike the request-scoped
 * generator in agent.ts, the state lives in the instance so a DO can persist /
 * resume it, and it has no node or @codegraff/sdk runtime deps — only the
 * env-injectable CubeSandbox + fetch — so it runs inside workerd.
 *
 * The composed prompt + system prompt + model are passed in (computed by the
 * route from agent.ts); provider keys come from the DO's own env. Tool-call
 * summarization is duplicated here (cosmetic status chips) to avoid importing
 * agent.ts's runtime.
 */
import type { AgentEvent } from "../lib/agent";
import { normalizeToolRejected } from "../lib/agent-event-normalizer";
import { summarizeToolCall } from "../lib/agent-tool-summary";
import { type CubeSandbox, GRAFF_BIN_PATH } from "../lib/cubesandbox";
import { ReasoningSanitizer, sanitizeAnswer } from "../lib/reasoning-sanitizer";
import {
  boundedText,
  MAX_ASK_TEXT_BYTES,
  safeAgentError,
} from "./ask-security";

/** graff `--json` stdout events. */
type GraffEvent =
  | { type: "reasoning" | "text"; text?: string }
  | { type: "tool_call"; name: string; input?: unknown }
  | {
      type: "tool_rejected";
      name: string;
      reason: "budget" | "duplicate";
      message?: string;
    }
  | { type: "turn"; text: string; cost_usd: number; context_tokens: number }
  | { type: "error"; message: string };

export interface GraffRunParams {
  model: string;
  providerEnv: Record<string, string>;
  prompt: string;
  systemPrompt: string;
  toolCallBudget: number;
}

const RUN_DEADLINE_MS = 300_000;

export interface GraffRunState {
  startedAt: number;
  workDir: string;
  sandboxId: string | null;
  launched: boolean;
  runtimeReady: boolean;
  done: boolean;
  failed: boolean;
  finalText: string;
  costUsd: number;
  contextTokens: number;
  offset: number;
  lineBuf: string;
  rawNonJson: string;
  streamedText: string;
  sanitizer: { pending: string; thinking: boolean };
  sawTurn: boolean;
  sawText: boolean;
  announcedAnswering: boolean;
  seenTools: [string, number][];
  lastHeartbeat: number;
}

interface LaunchOptions {
  sandboxId?: string;
  runtimeReady?: boolean;
  checkpoint?: () => Promise<void>;
}

/** Conservative guard against treating a visibly cut-off stream as success. */
export function isLikelyCompleteAnswer(text: string): boolean {
  const answer = text.trim();
  if (answer.length < 40) return false;
  if ((answer.match(/```/g) ?? []).length % 2 !== 0) return false;
  if (/[,;:\-–—]\s*$/.test(answer)) return false;

  const withoutMarkdownClosers = answer.replace(/[\])}"'_*`]+\s*$/g, "").trim();
  return !/\b(?:a|an|and|as|at|because|by|for|from|if|in|of|on|or|the|that|to|under|with)\s*$/i.test(
    withoutMarkdownClosers,
  );
}

/** Holds the parse state for one graff run so a DO can drive it across alarms. */
export class GraffRun {
  readonly startedAt: number;
  readonly workDir: string;
  launched = false;
  runtimeReady = false;
  sandboxId: string | null = null;
  done = false;
  failed = false;
  /** The final answer markdown once the turn completes. */
  finalText = "";
  costUsd = 0;
  contextTokens = 0;

  private offset = 0;
  private lineBuf = "";
  private rawNonJson = "";
  private streamedText = "";
  private sanitizer = new ReasoningSanitizer();
  private sawTurn = false;
  private sawText = false;
  private announcedAnswering = false;
  private seenTools = new Map<string, number>();
  private lastHeartbeat: number;

  constructor(
    startedAt: number = Date.now(),
    workDir = `/tmp/lawplain-runs/${crypto.randomUUID()}`,
  ) {
    this.startedAt = startedAt;
    this.workDir = workDir;
    this.lastHeartbeat = startedAt;
  }

  snapshot(): GraffRunState {
    return {
      startedAt: this.startedAt,
      workDir: this.workDir,
      sandboxId: this.sandboxId,
      launched: this.launched,
      runtimeReady: this.runtimeReady,
      done: this.done,
      failed: this.failed,
      finalText: this.finalText,
      costUsd: this.costUsd,
      contextTokens: this.contextTokens,
      offset: this.offset,
      lineBuf: this.lineBuf,
      rawNonJson: this.rawNonJson,
      streamedText: this.streamedText,
      sanitizer: this.sanitizer.snapshot(),
      sawTurn: this.sawTurn,
      sawText: this.sawText,
      announcedAnswering: this.announcedAnswering,
      seenTools: [...this.seenTools],
      lastHeartbeat: this.lastHeartbeat,
    };
  }

  static restore(state: GraffRunState): GraffRun {
    const run = new GraffRun(state.startedAt, state.workDir);
    run.sandboxId = state.sandboxId;
    run.launched = state.launched;
    run.runtimeReady = state.runtimeReady;
    run.done = state.done;
    run.failed = state.failed;
    run.finalText = state.finalText;
    run.costUsd = state.costUsd;
    run.contextTokens = state.contextTokens;
    run.offset = state.offset;
    run.lineBuf = state.lineBuf;
    run.rawNonJson = state.rawNonJson;
    run.streamedText = state.streamedText;
    run.sanitizer.restore(state.sanitizer);
    run.sawTurn = state.sawTurn;
    run.sawText = state.sawText;
    run.announcedAnswering = state.announcedAnswering;
    run.seenTools = new Map(state.seenTools);
    run.lastHeartbeat = state.lastHeartbeat;
    return run;
  }

  /** Stop this turn's process group without destroying the conversation VM. */
  async stop(sandbox: CubeSandbox): Promise<void> {
    if (!this.sandboxId) return;
    const result = await sandbox.runProcess(this.sandboxId, {
      cmd: "/bin/bash",
      args: [
        "-c",
        `mkdir -p "$RUN_DIR"
touch "$RUN_DIR/stopped"
if [ -s "$RUN_DIR/graff.pid" ]; then
  pid=$(cat "$RUN_DIR/graff.pid")
  case "$pid" in ''|*[!0-9]*) exit 1;; esac
  [ "$pid" -gt 1 ] || exit 1
  if kill -0 -- "-$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || true
    for attempt in 1 2 3 4 5; do
      kill -0 -- "-$pid" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 -- "-$pid" 2>/dev/null; then kill -KILL -- "-$pid" 2>/dev/null || true; fi
  fi
fi`,
      ],
      envs: { RUN_DIR: this.workDir },
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0)
      throw new Error("Could not stop research process");
  }

  private elapsed(now: number = Date.now()): number {
    return now - this.startedAt;
  }

  /** Create the sandbox, install graff, and launch the run in the background. */
  async launch(
    sandbox: CubeSandbox,
    params: GraffRunParams,
    onSandboxCreated?: (sandboxId: string) => void | Promise<void>,
    options: LaunchOptions = {},
  ): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    events.push({
      type: "progress",
      phase: "sandbox_start",
      message: options.sandboxId
        ? "Reusing this conversation’s sandbox…"
        : "Starting secure sandbox…",
      elapsedMs: this.elapsed(),
    });
    const sid =
      options.sandboxId ??
      (await sandbox.createSandbox({ cpuCount: 2, memoryMB: 1024 }));
    this.sandboxId = sid;
    await onSandboxCreated?.(sid);

    if (!options.runtimeReady && !this.runtimeReady) {
      events.push({
        type: "progress",
        phase: "agent_install",
        message: "Loading research runtime…",
        elapsedMs: this.elapsed(),
      });
      await sandbox.installGraff(sid);
    }
    this.runtimeReady = true;
    await options.checkpoint?.();

    const promptJson = JSON.stringify({ type: "user", text: params.prompt });
    const envs: Record<string, string> = {
      RUN_DIR: this.workDir,
      PROMPT_JSON: promptJson,
      SYSTEM_PROMPT: params.systemPrompt,
      GRAFF_BIN: GRAFF_BIN_PATH,
      MODEL: params.model,
      TOOL_CALL_BUDGET: String(
        Math.min(6, Math.max(1, Math.trunc(params.toolCallBudget))),
      ),
      ...params.providerEnv,
      HOME: "/home/user",
      PATH: "/usr/bin:/bin:/usr/local/bin",
      GRAFF_NO_TELEMETRY: "1",
    };

    events.push({
      type: "progress",
      phase: "agent_start",
      message: "Starting research agent…",
      elapsedMs: this.elapsed(),
    });

    const start = await sandbox.runProcess(sid, {
      cmd: "/bin/bash",
      args: [
        "-c",
        `mkdir -p "$RUN_DIR"
# The guest lock survives an ambiguous exec response or Worker restart.
# Re-entering launch can attach to this turn but cannot spawn it twice.
if mkdir "$RUN_DIR/launch.lock" 2>/dev/null; then
  if [ -e "$RUN_DIR/stopped" ]; then exit 0; fi
  nohup setsid /bin/bash -c 'printf %s "$PROMPT_JSON" | "$GRAFF_BIN" --json --yolo --no-telemetry --max-tool-calls "$TOOL_CALL_BUDGET" --dedupe-tool-calls --model "$MODEL" --system-prompt "$SYSTEM_PROMPT" > "$RUN_DIR/graff.out" 2> "$RUN_DIR/graff.err"; echo $? > "$RUN_DIR/graff.exit"' > "$RUN_DIR/graff.launch" 2>&1 < /dev/null &
  pid=$!
  echo "$pid" > "$RUN_DIR/graff.pid"
  if [ -e "$RUN_DIR/stopped" ]; then kill -TERM -- "-$pid" 2>/dev/null || true; fi
fi`,
      ],
      cwd: "/tmp",
      envs,
      timeoutMs: 10_000,
    });
    if (start.exitCode && start.exitCode !== 0) {
      throw new Error(`failed to start graff: ${start.stderr || start.stdout}`);
    }

    this.launched = true;
    await options.checkpoint?.();

    events.push({
      type: "progress",
      phase: "thinking",
      message: "Planning searches…",
      elapsedMs: this.elapsed(),
    });
    return events;
  }

  /**
   * Read whatever graff has written since the last poll and return the new
   * normalized events. Sets `done` (and emits the terminal done/error event)
   * once graff exits or the deadline passes.
   */
  async poll(sandbox: CubeSandbox): Promise<AgentEvent[]> {
    if (this.done) return [];
    const sid = this.sandboxId;
    if (!sid) return [];
    const events: AgentEvent[] = [];

    const rawOut =
      (await sandbox.readSandboxFile(sid, `${this.workDir}/graff.out`)) ?? "";
    const boundedOut = boundedText(rawOut, MAX_ASK_TEXT_BYTES);
    const out = boundedOut.text;
    if (boundedOut.truncated && this.offset >= out.length) {
      this.done = true;
      return [{ type: "error", message: safeAgentError() }];
    }
    if (out.length > this.offset) {
      this.lineBuf += out.slice(this.offset);
      this.offset = out.length;

      let nl = this.lineBuf.indexOf("\n");
      while (nl >= 0) {
        const line = this.lineBuf.slice(0, nl).trim();
        this.lineBuf = this.lineBuf.slice(nl + 1);
        if (!line) {
          nl = this.lineBuf.indexOf("\n");
          continue;
        }
        let ev: GraffEvent;
        try {
          ev = JSON.parse(line) as GraffEvent;
        } catch {
          if (this.rawNonJson.length < 2000) {
            this.rawNonJson += (this.rawNonJson ? "\n" : "") + line;
          }
          nl = this.lineBuf.indexOf("\n");
          continue;
        }
        switch (ev.type) {
          case "text":
            if (ev.text) {
              if (!this.announcedAnswering) {
                this.announcedAnswering = true;
                events.push({
                  type: "progress",
                  phase: "answering",
                  message: "Writing answer…",
                  elapsedMs: this.elapsed(),
                });
              }
              this.sawText = true;
              const remaining =
                MAX_ASK_TEXT_BYTES -
                new TextEncoder().encode(this.streamedText).length;
              const clean = this.sanitizer.push(ev.text);
              const text = boundedText(clean, Math.max(0, remaining));
              this.streamedText += text.text;
              if (text.text) events.push({ type: "delta", text: text.text });
              if (text.truncated) {
                this.done = true;
                return [
                  ...events,
                  { type: "error", message: safeAgentError() },
                ];
              }
            }
            break;
          case "tool_call": {
            const tool = summarizeToolCall(ev.name, ev.input);
            const count = (this.seenTools.get(tool.key) ?? 0) + 1;
            this.seenTools.set(tool.key, count);
            events.push({
              type: "progress",
              phase: tool.kind === "search" ? "searching" : "reading",
              message:
                tool.kind === "search"
                  ? `Searching ${tool.summary.slice(8)}…`
                  : `Reading source ${tool.summary}…`,
              elapsedMs: this.elapsed(),
            });
            events.push({
              type: "tool",
              name: ev.name,
              key: tool.key,
              summary: tool.summary,
              kind: tool.kind,
              duplicate: count > 1,
              count,
            });
            break;
          }
          case "tool_rejected":
            events.push(normalizeToolRejected(ev));
            break;
          case "turn":
            this.sawTurn = true;
            this.finalText = sanitizeAnswer(ev.text);
            this.costUsd = ev.cost_usd;
            this.contextTokens = ev.context_tokens;
            break;
          case "error":
            events.push({ type: "error", message: ev.message });
            this.done = true;
            return events;
          default:
            break;
        }
        nl = this.lineBuf.indexOf("\n");
      }
    }

    const exitText = await sandbox.readSandboxFile(
      sid,
      `${this.workDir}/graff.exit`,
    );
    if (exitText !== null) {
      const exitCode = Number.parseInt(exitText.trim(), 10);
      const stderr =
        (await sandbox.readSandboxFile(sid, `${this.workDir}/graff.err`)) ?? "";
      events.push(...(await this.finalize(sandbox, exitCode, stderr)));
      this.done = true;
      return events;
    }

    if (this.elapsed() >= RUN_DEADLINE_MS) {
      events.push({ type: "error", message: "sandboxed graff timed out" });
      this.done = true;
      return events;
    }

    const now = Date.now();
    if (now - this.lastHeartbeat > 8000) {
      this.lastHeartbeat = now;
      events.push({
        type: "progress",
        phase: this.sawText ? "answering" : "thinking",
        message: this.sawText ? "Still writing answer…" : "Still researching…",
        elapsedMs: this.elapsed(now),
      });
    }
    return events;
  }

  private async finalize(
    sandbox: CubeSandbox,
    exitCode: number,
    stderr: string,
  ): Promise<AgentEvent[]> {
    const sid = this.sandboxId;
    const failureDiag = async (): Promise<string> =>
      (
        this.rawNonJson.trim() ||
        stderr.trim() ||
        (sid
          ? ((await sandbox.readSandboxFile(
              sid,
              `${this.workDir}/graff.out`,
            )) ?? "")
          : ""
        ).trim()
      ).slice(0, 800);

    const tail = this.sanitizer.finish();
    this.streamedText += tail;
    const tailEvents: AgentEvent[] = tail
      ? [{ type: "delta", text: tail }]
      : [];
    if (exitCode && exitCode !== 0) {
      const diag = await failureDiag();
      return [
        ...tailEvents,
        {
          type: "error",
          message: diag
            ? `sandboxed graff exited with ${exitCode}: ${diag}`
            : `sandboxed graff exited with ${exitCode}`,
        },
      ];
    }
    if (!this.sawTurn && this.streamedText) {
      this.finalText = this.streamedText;
    } else if (!this.sawTurn) {
      const diag = await failureDiag();
      return [
        ...tailEvents,
        {
          type: "error",
          message: diag
            ? `sandboxed graff ended before producing an answer: ${diag}`
            : "sandboxed graff ended before producing an answer (no output)",
        },
      ];
    }
    if (!isLikelyCompleteAnswer(this.finalText)) {
      return [
        ...tailEvents,
        {
          type: "error",
          message:
            "The research output ended before the answer was complete. Please retry.",
        },
      ];
    }
    return [
      ...tailEvents,
      {
        type: "done",
        text: this.finalText,
        costUsd: this.costUsd,
        contextTokens: this.contextTokens,
      },
    ];
  }
}
