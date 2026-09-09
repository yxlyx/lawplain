/**
 * CubeSandbox gateway client — manages microVM sandboxes and runs processes
 * inside them via the envd Connect RPC API.
 *
 * The gateway is a Cloudflare Worker control plane in front of bare-metal
 * cube-api (E2B-compatible microVM) nodes. Each sandbox is a firewalled,
 * disposable firecracker VM — the agent's `bash` tool runs inside it, not on
 * the host, which is the "safe shell execution adapter" (issue #15).
 *
 * The `CubeSandbox` class takes its config explicitly so it can run anywhere
 * that has the gateway URL + tenant key — including a Durable Object, where
 * secrets come from `this.env` rather than `process.env`. The module also keeps
 * `process.env`-backed standalone helpers for backward compatibility with the
 * existing request-scoped Ask path.
 */

/** envd control API port (files + processes) inside every sandbox. */
const ENVD_PORT = 49983;

export interface CubeConfig {
  gatewayUrl: string;
  tenantKey: string;
}

export interface SandboxOptions {
  templateID?: string;
  cpuCount?: number;
  memoryMB?: number;
}

export interface ProcessOptions {
  cmd: string;
  args: string[];
  cwd?: string;
  envs?: Record<string, string>;
  timeoutMs?: number;
}

export interface ProcessChunk {
  type: "stdout" | "stderr" | "end";
  data: string;
  exitCode?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

const MAX_CONNECT_FRAME_BYTES = 1_000_000;
const MAX_PROCESS_OUTPUT_BYTES = 1_000_000;

function boundedUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= maxBytes) return value;
  return new TextDecoder().decode(bytes.slice(0, Math.max(0, maxBytes)), {
    stream: true,
  });
}

// ─── Connect RPC envelope codec ─────────────────────────────────────────

/**
 * envd uses Connect RPC streaming. Each frame is:
 *   1 byte flags (0 = normal, 2 = end-of-stream trailer)
 *   4 bytes big-endian uint32 length
 *   N bytes JSON payload
 */
function connectEnvelope(json: string): Buffer {
  const payload = Buffer.from(json, "utf-8");
  const buf = Buffer.alloc(5 + payload.length);
  buf[0] = 0; // flags: normal frame
  buf.writeUInt32BE(payload.length, 1); // big-endian length
  payload.copy(buf, 5);
  return buf;
}

/** Read big-endian uint32 from a Uint8Array at offset (safe for sliced views). */
function readU32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

/** Parse Connect streaming envelopes from a ReadableStream, yielding JSON objects. */
async function* parseConnectStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  let buf = new Uint8Array(0);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf);
      merged.set(value, buf.length);
      buf = merged;

      let i = 0;
      while (i + 5 <= buf.length) {
        const length = readU32BE(buf, i + 1);
        if (length > MAX_CONNECT_FRAME_BYTES) {
          throw new Error("sandbox response frame exceeded limit");
        }
        if (i + 5 + length > buf.length) break; // incomplete — wait for more
        const payload = buf.subarray(i + 5, i + 5 + length);
        i += 5 + length;
        try {
          yield JSON.parse(new TextDecoder().decode(payload)) as Record<
            string,
            unknown
          >;
        } catch {
          // skip malformed JSON
        }
      }
      buf = buf.subarray(i);
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── graff release ──────────────────────────────────────────────────────

export const GRAFF_DOWNLOAD_URL =
  process.env.GRAFF_DOWNLOAD_URL ??
  "https://github.com/justrach/codegraff/releases/download/v0.0.200/graff-x86_64-linux.tar.gz";

export const GRAFF_DOWNLOAD_SHA256 =
  "3fefe2bc01edd64f4974e0c9a529cab0b7ebd0cb0da5ef2e30c4d256d1856351";

export const GRAFF_BIN_PATH = "/tmp/graff-x86_64-linux/graff";

// ─── client ─────────────────────────────────────────────────────────────

export class CubeSandbox {
  private readonly cfg: CubeConfig;

  constructor(cfg: CubeConfig) {
    this.cfg = cfg;
  }

  private authHeaders(): Record<string, string> {
    return { "X-API-Key": this.cfg.tenantKey };
  }

  /** Create a new microVM sandbox. Returns the sandboxID. */
  async createSandbox(opts: SandboxOptions = {}): Promise<string> {
    const res = await fetch(`${this.cfg.gatewayUrl}/sandboxes`, {
      method: "POST",
      headers: { ...this.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        templateID: opts.templateID ?? "py312",
        cpuCount: opts.cpuCount ?? 1,
        memoryMB: opts.memoryMB ?? 512,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `createSandbox failed (${res.status}): ${await res.text()}`,
      );
    }
    const data = (await res.json()) as { sandboxID: string };
    return data.sandboxID;
  }

  /** Delete a sandbox (best-effort, never throws). */
  async deleteSandbox(sid: string): Promise<void> {
    try {
      await fetch(`${this.cfg.gatewayUrl}/sandboxes/${sid}`, {
        method: "DELETE",
        headers: this.authHeaders(),
      });
    } catch {
      // best-effort — sandbox will time out on its own
    }
  }

  /**
   * Start a process inside the sandbox and stream output chunks as they arrive.
   * The envd Process/Start RPC is server-streaming.
   */
  async *streamProcess(
    sid: string,
    opts: ProcessOptions,
  ): AsyncGenerator<ProcessChunk> {
    const url = `${this.cfg.gatewayUrl}/sandboxes/${sid}/host/${ENVD_PORT}/process.Process/Start`;
    const reqBody = JSON.stringify({
      process: {
        cmd: opts.cmd,
        args: opts.args,
        cwd: opts.cwd ?? "/home/user",
        envs: opts.envs ?? {},
      },
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "content-type": "application/connect+json",
      },
      body: connectEnvelope(reqBody) as BodyInit,
      signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });

    if (!res.ok || !res.body) {
      throw new Error(
        `streamProcess failed (${res.status}): ${await res.text()}`,
      );
    }

    for await (const msg of parseConnectStream(res.body)) {
      const event = msg.event as Record<string, unknown> | undefined;
      if (!event) continue;

      if (event.data) {
        const data = event.data as Record<string, unknown>;
        if (data.stdout) {
          yield {
            type: "stdout",
            data: Buffer.from(data.stdout as string, "base64").toString(),
          };
        }
        if (data.stderr) {
          yield {
            type: "stderr",
            data: Buffer.from(data.stderr as string, "base64").toString(),
          };
        }
      }

      if (event.end) {
        const end = event.end as Record<string, unknown>;
        yield {
          type: "end",
          data: String(end.status ?? ""),
          exitCode: (end.exitCode as number) ?? undefined,
        };
        return;
      }
    }
  }

  /** Run a process to completion with independently bounded output streams. */
  async runProcess(sid: string, opts: ProcessOptions): Promise<ProcessResult> {
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    for await (const chunk of this.streamProcess(sid, opts)) {
      if (chunk.type === "stdout") {
        const remaining = MAX_PROCESS_OUTPUT_BYTES - Buffer.byteLength(stdout);
        const bounded = boundedUtf8(chunk.data, remaining);
        stdout += bounded;
        if (bounded !== chunk.data) stdoutTruncated = true;
      } else if (chunk.type === "stderr") {
        const remaining = MAX_PROCESS_OUTPUT_BYTES - Buffer.byteLength(stderr);
        const bounded = boundedUtf8(chunk.data, remaining);
        stderr += bounded;
        if (bounded !== chunk.data) stderrTruncated = true;
      } else if (chunk.type === "end") exitCode = chunk.exitCode ?? null;
    }
    return { stdout, stderr, exitCode, stdoutTruncated, stderrTruncated };
  }

  /** Read a file from the sandbox via the envd files API. Null on 404. */
  async readSandboxFile(sid: string, path: string): Promise<string | null> {
    const res = await fetch(
      `${this.cfg.gatewayUrl}/sandboxes/${sid}/host/${ENVD_PORT}/files?path=${encodeURIComponent(path)}&username=root`,
      { headers: this.authHeaders() },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `readSandboxFile failed (${res.status}): ${await res.text()}`,
      );
    }
    return res.text();
  }

  /** Download and extract the graff binary into /tmp inside the sandbox. */
  async installGraff(
    sid: string,
    downloadUrl: string = GRAFF_DOWNLOAD_URL,
  ): Promise<void> {
    const url = new URL(downloadUrl);
    if (url.protocol !== "https:")
      throw new Error("graff download must use HTTPS");
    const checksum = `${GRAFF_DOWNLOAD_SHA256}  /tmp/graff.tar.gz\n`;
    const steps: ProcessOptions[] = [
      {
        cmd: "/bin/bash",
        args: ["-c", `printf %s "$CHECKSUM" > /tmp/graff.sha256`],
        envs: { CHECKSUM: checksum },
      },
      {
        cmd: "/usr/bin/curl",
        args: [
          "--fail",
          "--silent",
          "--show-error",
          "--location",
          "--output",
          "/tmp/graff.tar.gz",
          url.href,
        ],
      },
      {
        cmd: "/usr/bin/sha256sum",
        args: ["--check", "/tmp/graff.sha256"],
      },
      { cmd: "/bin/tar", args: ["xzf", "/tmp/graff.tar.gz", "-C", "/tmp"] },
      { cmd: "/bin/chmod", args: ["+x", GRAFF_BIN_PATH] },
    ];
    for (const step of steps) {
      const result = await this.runProcess(sid, {
        ...step,
        cwd: "/tmp",
        timeoutMs: 60_000,
      });
      if (result.exitCode !== null && result.exitCode !== 0) {
        throw new Error("installGraff failed");
      }
      if (
        step.cmd.endsWith("sha256sum") &&
        (!result.stdout.includes(": OK") || result.stdout.includes("FAILED"))
      ) {
        throw new Error("installGraff checksum verification failed");
      }
    }
    const version = await this.runProcess(sid, {
      cmd: GRAFF_BIN_PATH,
      args: ["--version"],
      cwd: "/tmp",
      timeoutMs: 10_000,
    });
    if (
      (version.exitCode !== null && version.exitCode !== 0) ||
      !(version.stdout || version.stderr).toLowerCase().includes("graff")
    ) {
      throw new Error("installGraff executable verification failed");
    }
  }
}

// ─── backward-compatible process.env-backed helpers ─────────────────────

let _default: CubeSandbox | null = null;
function defaultClient(): CubeSandbox {
  if (!_default) {
    _default = new CubeSandbox({
      gatewayUrl: process.env.CUBESANDBOX_GATEWAY_URL ?? "",
      tenantKey: process.env.CUBESANDBOX_TENANT_KEY ?? "",
    });
  }
  return _default;
}

export function createSandbox(opts: SandboxOptions = {}): Promise<string> {
  return defaultClient().createSandbox(opts);
}
export function deleteSandbox(sid: string): Promise<void> {
  return defaultClient().deleteSandbox(sid);
}
export function streamProcess(
  sid: string,
  opts: ProcessOptions,
): AsyncGenerator<ProcessChunk> {
  return defaultClient().streamProcess(sid, opts);
}
export function runProcess(
  sid: string,
  opts: ProcessOptions,
): Promise<ProcessResult> {
  return defaultClient().runProcess(sid, opts);
}
export function readSandboxFile(
  sid: string,
  path: string,
): Promise<string | null> {
  return defaultClient().readSandboxFile(sid, path);
}
export function installGraff(sid: string): Promise<void> {
  return defaultClient().installGraff(sid);
}
