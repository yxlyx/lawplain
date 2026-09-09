import {
  CubeSandbox,
  type ProcessChunk,
  type ProcessOptions,
  type SandboxOptions,
} from "./cubesandbox.ts";

const ORIGIN = "https://api.condensation.ai";
export const CONDENSATION_LEASE_SECONDS = 1800;
const MAX_FILE_BYTES = 1_000_000;

export interface FleetSandbox {
  id: string;
  state: string;
  expiresAt: number;
}

interface FleetOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

export class CondensationError extends Error {
  readonly status: number;

  constructor(status: number, operation: string) {
    super(`Condensation ${operation} failed (${status})`);
    this.name = "CondensationError";
    this.status = status;
  }
}

/** POSIX shell quoting: inputs are values, never shell source. */
export function shellQuote(value: string): string {
  if (value.includes("\0"))
    throw new Error("NUL is not a valid process argument");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Condensation's own fleet transport. Inherits only the bounded process
 * collector and checksum-verified graff installer; all Cube I/O is overridden.
 * The fleet key stays in the Worker, never in the research guest.
 */
export class CondensationSandbox extends CubeSandbox {
  private readonly apiKey: string;
  private readonly requestId: string;

  constructor(apiKey: string, requestId: string = crypto.randomUUID()) {
    super({ gatewayUrl: ORIGIN, tenantKey: apiKey });
    if (!apiKey) throw new Error("Condensation API key is not configured");
    this.apiKey = apiKey;
    this.requestId = requestId;
  }

  private path(sid: string): string {
    if (!/^cnd_[a-f0-9]{40}$/.test(sid))
      throw new Error("Invalid Condensation sandbox ID");
    return `/v1/fleet/sandboxes/${sid}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 90_000,
  ): Promise<T> {
    const res = await fetch(ORIGIN + path, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Workers supports manual/follow only. A 3xx is rejected below, so the
      // Authorization header is never forwarded to a redirect destination.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // Provider bodies can contain commands or credentials. Keep diagnostics
      // useful without exposing them to logs or the persisted event stream.
      throw new CondensationError(
        res.status,
        `${method} ${path.split("/").at(-1)}`,
      );
    }
    return res.json() as Promise<T>;
  }

  override async createSandbox(_opts: SandboxOptions = {}): Promise<string> {
    const box = await this.request<FleetSandbox>(
      "POST",
      "/v1/fleet/sandboxes",
      {
        requestId: this.requestId,
        name: "Lawplain research",
        leaseSeconds: CONDENSATION_LEASE_SECONDS,
      },
    );
    this.path(box.id);
    if (box.state !== "running") {
      await this.deleteSandbox(box.id);
      throw new Error("Condensation sandbox did not become ready");
    }
    return box.id;
  }

  async getSandbox(sid: string): Promise<FleetSandbox> {
    return this.request<FleetSandbox>("GET", this.path(sid));
  }

  override async deleteSandbox(sid: string): Promise<void> {
    const path = this.path(sid);
    let box = await this.request<FleetSandbox>("DELETE", path);
    // Delete can be accepted before settlement. Check state, without repeating
    // a potentially completed mutation. The lease also bounds orphan lifetime.
    if (box.state !== "terminated" && box.state !== "failed") {
      box = await this.request<FleetSandbox>("GET", path);
    }
    if (box.state !== "terminated" && box.state !== "failed") {
      throw new Error("Condensation sandbox cleanup is not yet confirmed");
    }
  }

  private exec(
    sid: string,
    command: string,
    timeoutSeconds = 30,
    cwd?: string,
  ) {
    return this.request<FleetOutput>(
      "POST",
      `${this.path(sid)}/exec`,
      {
        command,
        cwd,
        timeoutSeconds,
      },
      (timeoutSeconds + 15) * 1000,
    );
  }

  override async *streamProcess(
    sid: string,
    opts: ProcessOptions,
  ): AsyncGenerator<ProcessChunk> {
    const assignments = Object.entries(opts.envs ?? {}).map(([name, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new Error("Invalid process environment name");
      return shellQuote(`${name}=${value}`);
    });
    const script = `#!/bin/bash\nexec /usr/bin/env -- ${[
      ...assignments,
      shellQuote(opts.cmd),
      ...opts.args.map(shellQuote),
    ].join(" ")}\n`;
    const bytes = Buffer.from(script);
    if (bytes.length > MAX_FILE_BYTES)
      throw new Error("Research command is too large");
    // The fleet exec API accepts 16k characters, while a research prompt can be
    // larger. Upload a private script and invoke it with a short fixed command.
    const file = `/tmp/lawplain-${crypto.randomUUID()}.sh`;
    await this.request("POST", `${this.path(sid)}/upload`, {
      path: file,
      contentBase64: bytes.toString("base64"),
    });
    const quoted = shellQuote(file);
    const result = await this.exec(
      sid,
      `chmod 600 ${quoted} && /bin/bash ${quoted}; status=$?; rm -f ${quoted}; exit "$status"`,
      Math.max(1, Math.min(60, Math.ceil((opts.timeoutMs ?? 30_000) / 1000))),
      opts.cwd ?? "/tmp",
    );
    if (result.truncated)
      throw new Error("Condensation process output exceeded its limit");
    if (!Number.isInteger(result.exitCode))
      throw new Error("Condensation process exit status is missing");
    if (result.stdout) yield { type: "stdout", data: result.stdout };
    if (result.stderr) yield { type: "stderr", data: result.stderr };
    yield { type: "end", data: "", exitCode: result.exitCode };
  }

  override async readSandboxFile(
    sid: string,
    path: string,
  ): Promise<string | null> {
    // Condensation intentionally masks provider file-not-found errors as 503.
    // Check existence explicitly so a not-yet-created graff.exit is not mistaken
    // for a service outage, and never mask auth/network errors as missing files.
    const exists = await this.exec(sid, `test -f ${shellQuote(path)}`, 10);
    if (exists.exitCode === 1) return null;
    if (exists.exitCode !== 0)
      throw new Error("Condensation file check failed");
    const file = await this.request<{ contentBase64: string; bytes: number }>(
      "POST",
      `${this.path(sid)}/download`,
      { path },
      30_000,
    );
    if (file.bytes > MAX_FILE_BYTES)
      throw new Error("Research output exceeded its limit");
    const content = Buffer.from(file.contentBase64, "base64");
    if (content.length > MAX_FILE_BYTES)
      throw new Error("Research output exceeded its limit");
    return content.toString("utf8");
  }
}
