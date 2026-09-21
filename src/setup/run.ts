import { resolve } from "node:path";
import { PULSE_SETUP_PROMPT, detectSetupAdapters } from "../adapters/registry.js";
import { systemRuntime } from "../adapters/runtime.js";
import type { AdapterRuntime, DetectedAdapter, SetupAdapterId } from "../adapters/types.js";
import { init } from "../config/init.js";
import { installLocalFiles } from "../config/localFiles.js";
import { loadSession, saveSession } from "../config/session.js";
import type { CliFlags } from "../flow/context.js";
import * as ui from "../prompts/ui.js";
import { WizardError } from "../util/errors.js";

function skillHomes(adapterId?: SetupAdapterId): string[] {
  return adapterId === "claude-code" ? [".agents/skills", ".claude/skills"] : [".agents/skills"];
}

async function selectAdapter(
  detected: DetectedAdapter[],
  requested: string | undefined,
  previous: string | undefined,
): Promise<DetectedAdapter | undefined> {
  const available = detected.filter((entry) => entry.detection.available);
  if (requested) {
    const entry = detected.find((candidate) => candidate.adapter.id === requested);
    if (!entry) throw new WizardError(`unsupported coding agent or IDE: ${requested}`);
    if (!entry.detection.available) {
      throw new WizardError(`${entry.adapter.label} was requested but is not installed`);
    }
    return entry;
  }
  if (available.length === 0) return undefined;
  if (available.length === 1) return available[0];
  const id = await ui.select<SetupAdapterId>({
    message: "What do you want to use to set up Pulse?",
    initialValue: available.some((entry) => entry.adapter.id === previous)
      ? (previous as SetupAdapterId)
      : undefined,
    options: available.map((entry) => ({
      value: entry.adapter.id,
      label: entry.adapter.label,
      hint: entry.adapter.kind === "ide" ? "opens the IDE" : "interactive terminal",
    })),
  });
  return available.find((entry) => entry.adapter.id === id);
}

interface SetupDependencies {
  runtime?: AdapterRuntime;
  detected?: DetectedAdapter[];
}

export async function setup(
  flags: CliFlags = {},
  dependencies: SetupDependencies = {},
): Promise<void> {
  const repo = resolve(flags.repo ?? process.cwd());
  const runtime = dependencies.runtime ?? systemRuntime;
  ui.intro("Pulse Wizard");
  try {
    const config = await init(repo, flags, { announce: false, installFiles: false });
    ui.line("Pulse connection ready");

    const detected = dependencies.detected ?? (await detectSetupAdapters(runtime));
    const session = await loadSession(repo);
    const selected = await selectAdapter(detected, flags.agent, session.agentId);
    if (!selected) {
      await installLocalFiles(repo, [".agents/skills", ".claude/skills"], []);
      await saveSession(repo, { pulseUrl: config.pulseUrl, agentId: undefined });
      ui.note(
        [
          "Pulse is initialized, but no supported coding agent or IDE was detected.",
          "Install Claude Code, Codex, OpenCode, Cursor Agent, Gemini CLI, Cursor, or Windsurf.",
          "Then rerun this command, or open any coding agent here and ask:",
          PULSE_SETUP_PROMPT,
        ].join("\n\n"),
        "Setup pending",
      );
      ui.outro("Pulse initialization complete.");
      return;
    }

    const context = { repo, prompt: PULSE_SETUP_PROMPT };
    const supportFiles = selected.adapter.supportFiles(context);
    const backup = await installLocalFiles(repo, skillHomes(selected.adapter.id), supportFiles);
    await saveSession(repo, { pulseUrl: config.pulseUrl, agentId: selected.adapter.id });
    ui.line(`Selected ${selected.adapter.label}`);
    if (backup) ui.line(`Backed up previous local setup files to ${backup}`);

    if (selected.adapter.kind === "ide") {
      ui.note(selected.adapter.nextStep!, `Opening ${selected.adapter.label}`);
    } else {
      ui.note(
        "The agent will open with the Pulse setup prompt already submitted.",
        `Starting ${selected.adapter.label}`,
      );
    }
    const result = await selected.adapter.launch(context, selected.detection, runtime);
    if (result.code !== undefined && result.code !== 0 && result.code !== 130) {
      throw new WizardError(`${selected.adapter.label} exited with code ${result.code}`);
    }
    ui.outro(
      result.waitsForExit
        ? `${selected.adapter.label} session closed.`
        : `${selected.adapter.label} opened. ${selected.adapter.nextStep}`,
    );
  } catch (error) {
    if (error instanceof WizardError) {
      ui.note(error.message, "Setup failed");
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
