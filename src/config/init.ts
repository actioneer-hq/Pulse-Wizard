import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { GeneratedSupportFile } from "../adapters/types.js";
import { CANONICAL_CONTRACT } from "../integration/contract.js";
import { skillDir } from "../prompts/skills.js";
import * as ui from "../prompts/ui.js";
import { PulseClient } from "../pulse/client.js";
import { WizardError } from "../util/errors.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";
import { assertLocalPathsUntracked, ensureLocalExcludes, installLocalFiles } from "./localFiles.js";

export interface LocalConfig {
  dev: boolean;
  pulseUrl?: string;
  token?: string;
  org: string;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function refreshSkills(repoArg: string): Promise<void> {
  const repo = resolve(repoArg);
  if (!(await exists(repo))) throw new WizardError(`repo not found: ${repo}`);
  const backup = await installLocalFiles(repo, [".agents/skills", ".claude/skills"], []);
  await writeCanonicalContract(repo);
  ui.note(
    backup ? `Updated Pulse skills. Previous copies: ${backup}` : "Pulse skills are current.",
    "Pulse",
  );
}

async function writeCanonicalContract(repo: string): Promise<void> {
  const contracts = join(repo, ".pulse", "contracts");
  await mkdir(contracts, { recursive: true });
  await writeFile(
    join(contracts, "canonical.json"),
    `${JSON.stringify(CANONICAL_CONTRACT, null, 2)}\n`,
  );
}

interface InitOptions {
  announce?: boolean;
  installFiles?: boolean;
  skillHomes?: string[];
  supportFiles?: GeneratedSupportFile[];
}

async function optionalConfig(repo: string): Promise<LocalConfig | undefined> {
  try {
    return JSON.parse(await readFile(join(repo, ".pulse", "config.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function wizardCommand(): string {
  const root = dirname(dirname(dirname(skillDir("pulse-integration-mapping"))));
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return process.argv[1]?.endsWith(".ts")
    ? `npm --prefix ${quote(root)} run dev --`
    : `npx --yes ${PACKAGE_NAME}@${PACKAGE_VERSION}`;
}

export async function init(
  repoArg: string,
  flags: {
    dev?: boolean;
    pulseUrl?: string;
    token?: string;
    org?: string;
    reconfigure?: boolean;
  },
  options: InitOptions = {},
): Promise<LocalConfig> {
  const repo = resolve(repoArg);
  if (!(await exists(repo))) throw new WizardError(`repo not found: ${repo}`);
  await assertLocalPathsUntracked(repo, [".pulse"]);
  await ensureLocalExcludes(repo, [".pulse/"]);

  const existing = await optionalConfig(repo);
  const reuse = Boolean(existing && !flags.reconfigure && flags.dev === undefined);
  const dev = reuse ? existing!.dev : Boolean(flags.dev);
  const pulseUrl = dev
    ? undefined
    : (flags.pulseUrl ??
      (reuse ? existing?.pulseUrl : undefined) ??
      (await ui.text({
        message: "Pulse endpoint",
        validate: (value) => (/^https?:\/\//.test(value) ? undefined : "enter an http(s) URL"),
      })));
  const token = dev
    ? undefined
    : (flags.token ??
      (reuse ? existing?.token : undefined) ??
      (await ui.password({ message: "Agent ingest token" })));
  if (!dev && !token?.trim()) throw new WizardError("agent ingest token is required");
  if (!dev) {
    const reachable = await new PulseClient(pulseUrl!, token!, flags.org ?? existing?.org).health();
    if (!reachable) throw new WizardError(`Pulse health check failed at ${pulseUrl}`);
  }

  const dir = join(repo, ".pulse");
  await mkdir(dir, { recursive: true });
  const config: LocalConfig = {
    dev,
    pulseUrl,
    token,
    org: flags.org ?? existing?.org ?? "default",
  };
  await writeFile(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(join(dir, "config.json"), 0o600);
  await writeCanonicalContract(repo);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const wizard = wizardCommand();
  const target = `--repo ${quote(repo)}`;
  await writeFile(
    join(dir, "SETUP.md"),
    [
      "# Pulse setup",
      "",
      "Connect this voice-agent application to Pulse observability using pulse-integration-mapping.",
      "Read .agents/skills/pulse-integration-mapping/SKILL.md and every reference it requires.",
      "Read .pulse/contracts/canonical.json. It is the authoritative definition of Pulse's three atomic evidence families: Trace/OTLP, Audio, and Transcript.",
      "Treat application source as truth. .pulse/ is ignored Wizard state and never producer evidence.",
      "Work backward from every canonical field to its application producer, serializer, exporter or stored object. File names, extensions and formats do not determine relevance.",
      "Evaluate every deterministic section of each source. One file may provide Trace, Transcript and call metadata through separate mappers.",
      "If multiple valid sources provide the same fields, ask me to select one primary source for only those overlapping fields; preserve unique fields from every source.",
      "Write mapping-plan.json with exact source formats and complete canonical-field decisions before writing manifest.json or any mapper.",
      "Ignore summaries, RCA outputs, classifications and aggregate analytics that add no atomic canonical fact. Never emit derived metrics: producer-reported numbers ride span attrs from the contract's span_attr_vocabulary, already converted to canonical units.",
      "Evidence is nullable; nothing is invented. A source with no clock emits null times plus sequence (source order); untimed transcripts and spans are first-class. Prove every time unit from the code that writes the number and record unit_evidence on the projection.",
      "Do not request live bucket access, sample objects, credentials, or credential-label confirmation. Infer provider schemas and normalized field mappings from source; Pulse collects values and tests the connection later.",
      "Ask only short deployment-fact or duplicate-source questions that source cannot resolve. Prefer 2-3 selectable options plus a custom answer.",
      "If voice spans exist but have no exporter, ask before changing application source. Do not add missing voice instrumentation.",
      "",
      "The wizard CLI owns .pulse/config.json; do not print or copy its token.",
      "Write the final contract under .pulse/artifacts/integration/. Validate in a loop, then register:",
      "",
      "```sh",
      `${wizard} validate-integration ${target}`,
      `${wizard} register-integration ${target}`,
      "```",
      "",
    ].join("\n"),
  );
  if (options.installFiles !== false) {
    await installLocalFiles(
      repo,
      options.skillHomes ?? [".agents/skills", ".claude/skills"],
      options.supportFiles ?? [],
    );
  }
  if (options.announce !== false) {
    ui.note(`Initialized ${repo}\nUse the prompt in .pulse/SETUP.md.`, "Pulse");
  }
  return config;
}

export async function loadLocalConfig(repo: string): Promise<LocalConfig> {
  let config: LocalConfig;
  try {
    config = JSON.parse(await readFile(join(resolve(repo), ".pulse", "config.json"), "utf8"));
  } catch {
    throw new WizardError("run pulse-wizard init in this repo first");
  }
  if (!config.dev && (!config.pulseUrl || !config.token)) {
    throw new WizardError("Pulse endpoint and token are missing; rerun init");
  }
  return config;
}
