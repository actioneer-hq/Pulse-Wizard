import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadLocalConfig } from "../config/init.js";
import { skillDir, validatorScript } from "../prompts/skills.js";
import { PulseClient } from "../pulse/client.js";
import { LOCAL_MOCK_TOKEN, startMockPulseServer } from "../pulse/mock.js";
import {
  type ArtifactRule,
  type StorageManifest,
  validateDraft,
  validateManifest,
} from "../storage/manifest.js";
import { WizardError } from "../util/errors.js";
import { exec } from "../util/exec.js";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

interface MappingSource {
  source_kind: "otlp" | "json_log";
  sample_origin?: "captured" | "source_derived";
  storage_rule_id?: string;
}

async function mappingSource(artifact: string): Promise<MappingSource> {
  const raw = await json(join(artifact, "mapping-source.json")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return { source_kind: "otlp" };
      throw error;
    },
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new WizardError("mapping-source.json must be an object");
  }
  const source = raw as Record<string, unknown>;
  if (source.source_kind !== "otlp" && source.source_kind !== "json_log") {
    throw new WizardError("mapping-source.json requires source_kind otlp or json_log");
  }
  if (
    Object.keys(source).some(
      (key) => !["source_kind", "sample_origin", "storage_rule_id"].includes(key),
    )
  ) {
    throw new WizardError("mapping-source.json has unsupported fields");
  }
  if (
    source.sample_origin !== undefined &&
    !["captured", "source_derived"].includes(String(source.sample_origin))
  ) {
    throw new WizardError("mapping-source.json has invalid sample_origin");
  }
  if (
    source.source_kind === "json_log" &&
    (typeof source.storage_rule_id !== "string" || !source.storage_rule_id.trim())
  ) {
    throw new WizardError("json_log mapping requires storage_rule_id");
  }
  if (source.source_kind === "json_log" && source.sample_origin === undefined) {
    throw new WizardError("json_log mapping requires sample_origin");
  }
  return source as unknown as MappingSource;
}

async function confirmLogRule(repo: string, ruleId: string): Promise<void> {
  const path = join(repo, ".pulse", "artifacts", "storage", "storage-manifest.json");
  let manifest: StorageManifest;
  try {
    manifest = validateManifest(await json(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WizardError("json_log mapping requires a confirmed storage-manifest.json");
    }
    throw error;
  }
  const find = (rules: ArtifactRule[]): ArtifactRule | undefined => {
    for (const rule of rules) {
      if (rule.id === ruleId) return rule;
      const nested = find(rule.members ?? []);
      if (nested) return nested;
    }
    return undefined;
  };
  const rule = manifest.sources.map((source) => find(source.rules)).find(Boolean);
  if (!rule || rule.id !== ruleId || rule.decoder !== "json" || rule.kind !== "log") {
    throw new WizardError(`storage rule ${ruleId} must be a confirmed JSON log rule`);
  }
}

async function validateMapping(repo: string): Promise<MappingSource> {
  const artifact = join(repo, ".pulse", "artifacts", "otlp");
  const source = await mappingSource(artifact);
  if (source.source_kind === "json_log") await confirmLogRule(repo, source.storage_rule_id!);
  const result = await exec(
    "node",
    [
      validatorScript(skillDir("pulse-otlp-mapping")),
      join(artifact, "mapping.jsonata"),
      join(artifact, source.source_kind === "otlp" ? "sample-otlp.json" : "sample-json-log.json"),
      join(artifact, "canonical-trace.json"),
      join(artifact, "coverage.json"),
      source.source_kind,
    ],
    { cwd: repo },
  );
  if (result.code !== 0)
    throw new WizardError(result.stdout || result.stderr || "mapping validation failed");
  process.stdout.write(result.stdout || "Trace mapping validated\n");
  return source;
}

export async function localCommand(
  command: string,
  repoArg: string,
  confirmed = false,
): Promise<void> {
  const repo = resolve(repoArg);
  if (command === "validate-otlp" || command === "validate-trace-mapping") {
    await validateMapping(repo);
    return;
  }
  const storageDir = join(repo, ".pulse", "artifacts", "storage");
  if (command === "validate-storage") {
    const draft = validateDraft(await json(join(storageDir, "storage-draft.json")));
    if ("status" in draft) {
      process.stdout.write(`Storage blocked (${draft.status}): ${draft.reason}\n`);
      return;
    }
    process.stdout.write("Storage draft valid; developer confirmation still required.\n");
    return;
  }

  const config = await loadLocalConfig(repo);
  if (!["register-otlp", "register-trace-mapping", "register-storage"].includes(command)) {
    throw new WizardError(`unknown command: ${command}`);
  }
  const mock = config.dev ? await startMockPulseServer() : undefined;
  const pulse = new PulseClient(
    mock?.url ?? config.pulseUrl!,
    mock ? LOCAL_MOCK_TOKEN : config.token!,
    config.org,
  );
  try {
    if (command === "register-otlp" || command === "register-trace-mapping") {
      const source = await validateMapping(repo);
      const artifact = join(repo, ".pulse", "artifacts", "otlp");
      const expression = await readFile(join(artifact, "mapping.jsonata"), "utf8");
      if (command === "register-otlp" && source.source_kind !== "otlp") {
        throw new WizardError("json_log mappings require register-trace-mapping");
      }
      const { version } =
        source.source_kind === "otlp"
          ? await pulse.putOtlpMapping(expression)
          : await pulse.putJsonLogMapping({
              expression,
              storage_rule_id: source.storage_rule_id!,
              sample_origin: source.sample_origin!,
            });
      const meta = await json(join(artifact, "integration.json")).catch(() => null);
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        const m = meta as Record<string, unknown>;
        await pulse.putAgentMeta(
          Object.fromEntries(
            ["use_case", "framework", "language"]
              .filter((key) => typeof m[key] === "string")
              .map((key) => [key, m[key]]),
          ),
        );
      }
      process.stdout.write(`Pulse accepted ${source.source_kind} mapping v${version}\n`);
      return;
    }
    if (!confirmed)
      throw new WizardError("register-storage requires --confirmed after developer review");
    const manifest = validateManifest(await json(join(storageDir, "storage-manifest.json")));
    await pulse.putStorageManifest(manifest);
    process.stdout.write("Pulse accepted storage manifest\n");
  } finally {
    await mock?.close();
  }
}
