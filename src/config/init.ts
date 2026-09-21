import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { GeneratedSupportFile } from "../adapters/types.js";
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
  ui.note(
    backup ? `Updated Pulse skills. Previous copies: ${backup}` : "Pulse skills are current.",
    "Pulse",
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
  const root = dirname(dirname(dirname(skillDir("pulse-otlp-mapping"))));
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
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const wizard = wizardCommand();
  const target = `--repo ${quote(repo)}`;
  await writeFile(
    join(dir, "SETUP.md"),
    [
      "# Pulse setup",
      "",
      "Open your coding agent in this repository and ask:",
      "Connect this voice-agent application to Pulse observability using pulse-otlp-mapping and pulse-storage-mapping.",
      "Inspect application producers; .pulse/ is Wizard working state, not producer evidence.",
      "Inspect voice telemetry and blob storage together. If usable OTLP and call-linked JSON logs both exist, ask me which primary source to map. If voice spans lack an exporter, ask before adding one.",
      "Assume I know my application and storage, not Pulse internals. Ask about my deployment in plain language: where calls are saved, which files and layouts are active, and who speaks on each audio channel. Derive Pulse prefixes, regexes, rules, and credential mappings yourself; ask me to correct factual mistakes, not to design the manifest.",
      "Do not ask me to confirm known credential-label mappings. Apply them directly, including HMAC access ID -> access_key_id and HMAC secret -> secret_access_key. Ask only when a provider-specific label or authentication method is genuinely unknown.",
      "Keep every needed confirmation short and focused on one decision. Use the agent's selectable question UI when available, with 2-3 concise, evidence-based choices and a way to give a custom written answer.",
      "If selectable questions are unavailable, show numbered choices and accept either a number or a custom answer. Ask for brief free text only when the answer cannot sensibly be offered as choices, such as a bucket name.",
      "",
      "Both skills are installed locally. Read their SKILL.md files before acting.",
      "The wizard CLI owns .pulse/config.json; do not print or copy its token.",
      "Run these commands from this repo when the skills request validation or registration:",
      "",
      "```sh",
      `${wizard} validate-storage ${target}`,
      `${wizard} register-storage ${target} --confirmed`,
      `${wizard} validate-trace-mapping ${target}`,
      `${wizard} register-trace-mapping ${target}`,
      `${wizard} validate-otlp ${target}  # legacy OTLP alias`,
      `${wizard} register-otlp ${target}  # legacy OTLP alias`,
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
