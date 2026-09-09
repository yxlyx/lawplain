import type { FleetSandbox } from "../lib/condensation-sandbox.ts";

export const SESSION_IDLE_MS = 15 * 60_000;
export const SESSION_RUN_MS = 8 * 60_000;
export const SESSION_TURN_RESERVE_MS = 6 * 60_000;

export interface SessionState {
  userId: string;
  threadId: string;
  requestId?: string;
  sandboxId?: string;
  expiresAt?: number;
  activeRunId?: string;
  activeUntil?: number;
  idleUntil?: number;
  runtimeReady?: boolean;
  disposed?: boolean;
}

export interface SessionLease {
  sandboxId: string;
  expiresAt: number;
  reused: boolean;
  runtimeReady: boolean;
}

export class SessionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface SessionStore {
  get(): Promise<SessionState | undefined>;
  put(state: SessionState): Promise<void>;
  alarm(at: number): Promise<void>;
}
export interface SessionFleet {
  create(requestId: string): Promise<string>;
  get(sandboxId: string): Promise<FleetSandbox>;
  delete(sandboxId: string): Promise<void>;
}

/** Calls must be serialized by the owning Durable Object. No client supplies a VM id. */
export class AskSession {
  private readonly store: SessionStore;
  private readonly fleet: SessionFleet;
  private readonly now: () => number;
  constructor(
    store: SessionStore,
    fleet: SessionFleet,
    now: () => number = Date.now,
  ) {
    this.store = store;
    this.fleet = fleet;
    this.now = now;
  }

  private async owned(userId: string, threadId: string): Promise<SessionState> {
    const state = await this.store.get();
    if (state && (state.userId !== userId || state.threadId !== threadId))
      throw new SessionError(404, "Research session not found");
    return state ?? { userId, threadId };
  }

  private async retire(state: SessionState): Promise<void> {
    if (!state.sandboxId && state.requestId) {
      // An interrupted POST may have created the VM before its response was
      // saved. Recover the same idempotent resource before retiring its identity.
      state.sandboxId = await this.fleet.create(state.requestId);
      await this.store.put(state);
    }
    if (state.sandboxId) await this.fleet.delete(state.sandboxId);
    delete state.sandboxId;
    delete state.requestId;
    delete state.expiresAt;
    delete state.runtimeReady;
    delete state.activeRunId;
    delete state.activeUntil;
    delete state.idleUntil;
    await this.store.put(state);
  }

  async acquire(
    userId: string,
    threadId: string,
    runId: string,
    existingSandboxId?: string,
  ): Promise<SessionLease> {
    const state = await this.owned(userId, threadId);
    if (state.disposed)
      throw new SessionError(410, "Research session was deleted");
    // Adopt a run created by the previous deployment instead of abandoning it.
    // Only the run DO can supply this id, from its own persisted sandbox record.
    if (existingSandboxId && !state.sandboxId && !state.requestId) {
      const box = await this.fleet.get(existingSandboxId);
      if (box.state !== "running")
        throw new SessionError(410, "Research sandbox expired");
      state.sandboxId = box.id;
      state.expiresAt = box.expiresAt * 1000;
      state.activeRunId = runId;
      state.activeUntil = this.now() + SESSION_RUN_MS;
      state.runtimeReady = true;
      await this.store.put(state);
    }
    if (state.activeRunId && state.activeRunId !== runId) {
      if ((state.activeUntil ?? Infinity) > this.now())
        throw new SessionError(
          409,
          "This conversation already has research running",
        );
      await this.retire(state);
    }
    // A fixed provider lease cannot be extended. Do not start a five-minute
    // turn in a VM that will be reaped halfway through it.
    if (
      state.sandboxId &&
      !state.activeRunId &&
      ((state.expiresAt ?? 0) - this.now() < SESSION_TURN_RESERVE_MS ||
        (state.idleUntil ?? Infinity) <= this.now())
    ) {
      await this.retire(state);
    }
    let reused = !!state.sandboxId;
    if (state.sandboxId) {
      let box: FleetSandbox;
      try {
        box = await this.fleet.get(state.sandboxId);
      } catch (error) {
        // Only a definitive 404 permits replacing a missing VM. Auth failures
        // and transient provider outages must never create another sandbox.
        if ((error as { status?: number }).status !== 404) throw error;
        box = { id: state.sandboxId, state: "terminated", expiresAt: 0 };
      }
      if (box.state === "terminated" || box.state === "failed") {
        delete state.sandboxId;
        delete state.requestId;
        delete state.runtimeReady;
        delete state.expiresAt;
        if (state.activeRunId === runId) {
          delete state.activeRunId;
          delete state.activeUntil;
          await this.store.put(state);
          throw new SessionError(410, "Research sandbox expired");
        }
        reused = false;
      } else if (box.state !== "running") {
        throw new SessionError(
          503,
          "Research sandbox is temporarily unavailable",
        );
      } else {
        state.expiresAt = box.expiresAt * 1000;
      }
    }
    state.activeRunId = runId;
    state.activeUntil ??= this.now() + SESSION_RUN_MS;
    delete state.idleUntil;
    state.requestId ??= crypto.randomUUID();
    // Persist ownership and the creation identity before touching the provider.
    await this.store.put(state);
    await this.store.alarm(state.activeUntil);
    if (!state.sandboxId) {
      try {
        state.sandboxId = await this.fleet.create(state.requestId);
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (
          status === 400 ||
          status === 401 ||
          status === 403 ||
          status === 429
        ) {
          // These responses definitively rejected creation; they own no VM.
          delete state.requestId;
          delete state.activeRunId;
          delete state.activeUntil;
          await this.store.put(state);
        }
        throw error;
      }
      await this.store.put(state);
      const box = await this.fleet.get(state.sandboxId);
      if (box.state !== "running")
        throw new SessionError(503, "Research sandbox is not ready");
      state.expiresAt = box.expiresAt * 1000;
      if (!Number.isFinite(state.expiresAt) || state.expiresAt <= this.now())
        throw new SessionError(503, "Research sandbox lease is invalid");
      await this.store.put(state);
    }
    return {
      sandboxId: state.sandboxId,
      expiresAt: state.expiresAt!,
      reused,
      runtimeReady: !!state.runtimeReady,
    };
  }

  async release(
    userId: string,
    threadId: string,
    runId: string,
    sandboxId: string,
    runtimeReady: boolean,
  ): Promise<void> {
    const state = await this.owned(userId, threadId);
    // A late callback from an older run cannot unlock or kill a newer turn.
    if (state.activeRunId !== runId || state.sandboxId !== sandboxId) return;
    delete state.activeRunId;
    delete state.activeUntil;
    state.runtimeReady ||= runtimeReady;
    state.idleUntil = Math.min(
      this.now() + SESSION_IDLE_MS,
      state.expiresAt ?? this.now(),
    );
    await this.store.put(state);
    await this.store.alarm(state.idleUntil);
  }

  async retireRun(
    userId: string,
    threadId: string,
    runId: string,
    sandboxId: string,
  ): Promise<void> {
    const state = await this.owned(userId, threadId);
    if (state.activeRunId !== runId || state.sandboxId !== sandboxId) return;
    await this.retire(state);
  }

  async dispose(userId: string, threadId: string): Promise<void> {
    const state = await this.owned(userId, threadId);
    state.disposed = true;
    await this.store.put(state);
    await this.store.alarm(this.now());
    await this.retire(state);
  }

  async cleanup(): Promise<void> {
    const state = await this.store.get();
    if (!state) return;
    const deadline = state.disposed
      ? 0
      : state.activeRunId
        ? state.activeUntil
        : state.idleUntil;
    if (deadline === undefined) return;
    if (deadline > this.now()) {
      await this.store.alarm(deadline);
      return;
    }
    await this.retire(state);
  }
}
