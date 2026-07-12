import {
  type AgentEvent,
  askLegalAgent,
  askLegalAgentSandboxed,
  type ChatContext,
  type ChatTurn,
} from "@/lib/agent";
import { updateThreadRunStatus } from "@/lib/ask-threads";

const MAX_EVENTS = 2_000;
const RUN_TTL_MS = 30 * 60 * 1000;

type RunStatus = "running" | "done" | "error" | "stopped";

interface MemoryRun {
  key: string;
  events: AgentEvent[];
  baseIndex: number;
  nextIndex: number;
  status: RunStatus;
  abort: AbortController;
  waiters: Set<() => void>;
  updatedAt: number;
  promise: Promise<void>;
}

interface StartMemoryRunInput {
  userId: string;
  runId: string;
  question: string;
  threadId?: string;
  context?: ChatContext;
  history?: ChatTurn[];
  kind?: string;
  useSandbox: boolean;
}

const globalRuns = globalThis as typeof globalThis & {
  __askMemoryRuns?: Map<string, MemoryRun>;
};

const runs = globalRuns.__askMemoryRuns ?? new Map<string, MemoryRun>();
globalRuns.__askMemoryRuns = runs;

function runKey(userId: string, runId: string): string {
  return `${userId}:${runId}`;
}

function sse(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function notify(run: MemoryRun): void {
  for (const waiter of run.waiters) waiter();
  run.waiters.clear();
}

async function updateThreadStatus(
  input: StartMemoryRunInput,
  status: RunStatus,
): Promise<void> {
  if (!input.threadId || status === "running") return;
  await updateThreadRunStatus({
    userId: input.userId,
    id: input.threadId,
    status,
    unread: status === "done",
    clearUnread: status !== "done",
    unreadOnlyIfRunning: true,
  }).catch(() => {});
}

function append(run: MemoryRun, event: AgentEvent): void {
  run.events.push(event);
  run.nextIndex += 1;
  if (run.events.length > MAX_EVENTS) {
    const drop = run.events.length - MAX_EVENTS;
    run.events.splice(0, drop);
    run.baseIndex += drop;
  }
  run.updatedAt = Date.now();
  notify(run);
}

function waitForEvent(run: MemoryRun): Promise<void> {
  return new Promise((resolve) => {
    run.waiters.add(resolve);
  });
}

function sweepRuns(): void {
  const cutoff = Date.now() - RUN_TTL_MS;
  for (const [key, run] of runs) {
    if (run.status !== "running" && run.updatedAt < cutoff) runs.delete(key);
  }
}

export function startMemoryAskRun(input: StartMemoryRunInput): MemoryRun {
  sweepRuns();

  const key = runKey(input.userId, input.runId);
  const existing = runs.get(key);
  if (existing) return existing;

  const abort = new AbortController();
  const run: MemoryRun = {
    key,
    events: [],
    baseIndex: 0,
    nextIndex: 0,
    status: "running",
    abort,
    waiters: new Set(),
    updatedAt: Date.now(),
    promise: Promise.resolve(),
  };
  runs.set(key, run);

  run.promise = (async () => {
    try {
      if (input.context) {
        append(run, {
          type: "progress",
          phase: "context",
          message: `Using pinned ${input.kind} ${input.context.citation}.`,
          elapsedMs: 0,
        });
      }

      const agent = input.useSandbox ? askLegalAgentSandboxed : askLegalAgent;
      for await (const ev of agent(
        input.question,
        abort.signal,
        input.context,
        input.history,
      )) {
        append(run, ev);
        if (ev.type === "error") {
          run.status = "error";
          break;
        }
        if (ev.type === "done") {
          run.status = "done";
          break;
        }
      }

      if (abort.signal.aborted && run.status === "running") {
        append(run, {
          type: "progress",
          phase: "stopped",
          message: "Research exited by request.",
        });
        run.status = "stopped";
      } else if (run.status === "running") {
        run.status = "done";
      }
    } catch (err) {
      if (abort.signal.aborted) {
        append(run, {
          type: "progress",
          phase: "stopped",
          message: "Research exited by request.",
        });
        run.status = "stopped";
      } else {
        append(run, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        run.status = "error";
      }
    } finally {
      run.updatedAt = Date.now();
      await updateThreadStatus(input, run.status);
      notify(run);
    }
  })();

  return run;
}

export function hasMemoryAskRun(userId: string, runId: string): boolean {
  return runs.has(runKey(userId, runId));
}

export function getMemoryAskRunStatus(
  userId: string,
  runId: string,
): RunStatus | null {
  return runs.get(runKey(userId, runId))?.status ?? null;
}

export function stopMemoryAskRun(userId: string, runId: string): boolean {
  const run = runs.get(runKey(userId, runId));
  if (!run) return false;
  if (run.status === "running") run.abort.abort();
  return true;
}

export function streamMemoryAskRun(
  userId: string,
  runId: string,
  from: number,
): Response | null {
  const run = runs.get(runKey(userId, runId));
  if (!run) return null;

  const encoder = new TextEncoder();
  let cursor = Math.max(run.baseIndex, Math.floor(from));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(sse(event)));
      };

      try {
        for (;;) {
          if (cursor < run.baseIndex) {
            send({
              type: "error",
              message:
                "This research run is no longer available; please retry.",
            });
            break;
          }

          while (cursor < run.nextIndex) {
            const event = run.events[cursor - run.baseIndex];
            if (event) send(event);
            cursor += 1;
          }

          if (run.status !== "running") break;
          await waitForEvent(run);
        }
      } catch {
        // Client disconnected; detach only. The run continues in memory.
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // Detach only. Explicit Stop is responsible for aborting the agent.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    },
  });
}
