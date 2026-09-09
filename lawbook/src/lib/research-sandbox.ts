import { CondensationSandbox } from "./condensation-sandbox.ts";
import { CubeSandbox } from "./cubesandbox.ts";

type Env = Record<string, unknown>;

function provider(env: Env): unknown {
  return (
    env.LAWPLAIN_SANDBOX_PROVIDER ??
    (env.CONDENSATION_API_KEY ? "condensation" : "cubesandbox")
  );
}

export function sandboxConfigured(env: Env): boolean {
  if (provider(env) === "condensation")
    return (
      typeof env.CONDENSATION_API_KEY === "string" && !!env.CONDENSATION_API_KEY
    );
  return (
    provider(env) === "cubesandbox" &&
    typeof env.CUBESANDBOX_GATEWAY_URL === "string" &&
    !!env.CUBESANDBOX_GATEWAY_URL &&
    typeof env.CUBESANDBOX_TENANT_KEY === "string" &&
    !!env.CUBESANDBOX_TENANT_KEY
  );
}

export function createResearchSandbox(
  env: Env,
  options: { requestId?: string; existingSandboxId?: string } = {},
): CubeSandbox {
  // Cleanup after a deployment must use the provider that created the VM.
  const selected = options.existingSandboxId
    ? options.existingSandboxId.startsWith("cnd_")
      ? "condensation"
      : "cubesandbox"
    : provider(env);
  if (selected === "condensation") {
    return new CondensationSandbox(
      typeof env.CONDENSATION_API_KEY === "string"
        ? env.CONDENSATION_API_KEY
        : "",
      options.requestId,
    );
  }
  if (
    selected !== "cubesandbox" ||
    !env.CUBESANDBOX_GATEWAY_URL ||
    !env.CUBESANDBOX_TENANT_KEY
  )
    throw new Error("Research sandbox is not configured");
  return new CubeSandbox({
    gatewayUrl: String(env.CUBESANDBOX_GATEWAY_URL),
    tenantKey: String(env.CUBESANDBOX_TENANT_KEY),
  });
}
