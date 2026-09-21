import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AdapterContext,
  AdapterDetection,
  AdapterRuntime,
  DetectedAdapter,
  GeneratedSupportFile,
  SetupAdapter,
  SetupAdapterId,
} from "./types.js";

interface TerminalDefinition {
  id: SetupAdapterId;
  label: string;
  command: string;
  args(prompt: string): string[];
}

class TerminalAdapter implements SetupAdapter {
  readonly kind = "terminal" as const;

  constructor(private readonly definition: TerminalDefinition) {}

  get id(): SetupAdapterId {
    return this.definition.id;
  }

  get label(): string {
    return this.definition.label;
  }

  async detect(runtime: AdapterRuntime): Promise<AdapterDetection> {
    const available = await runtime.commandExists(this.definition.command);
    return {
      available,
      target: available ? { command: this.definition.command } : undefined,
    };
  }

  supportFiles(_context: AdapterContext): GeneratedSupportFile[] {
    return [];
  }

  async launch(context: AdapterContext, detection: AdapterDetection, runtime: AdapterRuntime) {
    const target = detection.target!;
    const code = await runtime.run(
      target.command,
      [...(target.argsPrefix ?? []), ...this.definition.args(context.prompt)],
      { cwd: context.repo, inherit: true },
    );
    return { code, waitsForExit: true };
  }
}

interface IdeDefinition {
  id: SetupAdapterId;
  label: string;
  command: string;
  macApp: string;
  macPaths: string[];
  windowsPaths: string[];
  supportFile: GeneratedSupportFile;
  nextStep: string;
}

class IdeAdapter implements SetupAdapter {
  readonly kind = "ide" as const;
  readonly nextStep: string;

  constructor(private readonly definition: IdeDefinition) {
    this.nextStep = definition.nextStep;
  }

  get id(): SetupAdapterId {
    return this.definition.id;
  }

  get label(): string {
    return this.definition.label;
  }

  async detect(runtime: AdapterRuntime): Promise<AdapterDetection> {
    if (await runtime.commandExists(this.definition.command)) {
      return { available: true, target: { command: this.definition.command } };
    }
    if (runtime.platform === "darwin") {
      for (const path of this.definition.macPaths) {
        if (await runtime.pathExists(path)) {
          return {
            available: true,
            target: { command: "open", argsPrefix: ["-a", this.definition.macApp] },
          };
        }
      }
    }
    if (runtime.platform === "win32") {
      for (const path of this.definition.windowsPaths) {
        if (await runtime.pathExists(path)) return { available: true, target: { command: path } };
      }
    }
    return { available: false };
  }

  supportFiles(_context: AdapterContext): GeneratedSupportFile[] {
    return [this.definition.supportFile];
  }

  async launch(context: AdapterContext, detection: AdapterDetection, runtime: AdapterRuntime) {
    const target = detection.target!;
    const code = await runtime.run(target.command, [...(target.argsPrefix ?? []), context.repo], {
      cwd: context.repo,
      inherit: false,
    });
    return { code, waitsForExit: false };
  }
}

const SETUP_INSTRUCTION =
  "Read .pulse/SETUP.md and both Pulse skills under .agents/skills/, then use pulse-otlp-mapping and pulse-storage-mapping to connect this repository to Pulse. Ask me to confirm every storage finding.";

function appPaths(name: string): string[] {
  return [`/Applications/${name}.app`, join(homedir(), "Applications", `${name}.app`)];
}

function windowsAppPaths(...parts: string[]): string[] {
  const roots = [
    process.env.LOCALAPPDATA,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ];
  return roots.filter((root): root is string => Boolean(root)).map((root) => join(root, ...parts));
}

export function allSetupAdapters(): SetupAdapter[] {
  return [
    new TerminalAdapter({
      id: "claude-code",
      label: "Claude Code",
      command: "claude",
      args: (prompt) => [prompt],
    }),
    new TerminalAdapter({
      id: "codex",
      label: "Codex",
      command: "codex",
      args: (prompt) => [prompt],
    }),
    new TerminalAdapter({
      id: "opencode",
      label: "OpenCode",
      command: "opencode",
      args: (prompt) => ["--prompt", prompt],
    }),
    new TerminalAdapter({
      id: "cursor-agent",
      label: "Cursor Agent",
      command: "cursor-agent",
      args: (prompt) => [prompt],
    }),
    new TerminalAdapter({
      id: "gemini-cli",
      label: "Gemini CLI",
      command: "gemini",
      args: (prompt) => ["-i", prompt],
    }),
    new IdeAdapter({
      id: "cursor-ide",
      label: "Cursor IDE",
      command: "cursor",
      macApp: "Cursor",
      macPaths: appPaths("Cursor"),
      windowsPaths: windowsAppPaths("Programs", "cursor", "Cursor.exe"),
      supportFile: {
        path: ".cursor/commands/pulse-setup.md",
        content: `---\ndescription: Connect this voice-agent repository to Pulse observability\n---\n\n${SETUP_INSTRUCTION}\n`,
      },
      nextStep: "Open Cursor Agent and run /pulse-setup",
    }),
    new IdeAdapter({
      id: "windsurf",
      label: "Windsurf",
      command: "windsurf",
      macApp: "Windsurf",
      macPaths: appPaths("Windsurf"),
      windowsPaths: windowsAppPaths("Programs", "Windsurf", "Windsurf.exe"),
      supportFile: {
        path: ".windsurf/workflows/pulse-setup.md",
        content: `# Pulse setup\n\n${SETUP_INSTRUCTION}\n`,
      },
      nextStep: "Open Cascade (Cmd/Ctrl+L), run /pulse-setup, and press Enter",
    }),
  ];
}

export async function detectSetupAdapters(runtime: AdapterRuntime): Promise<DetectedAdapter[]> {
  const adapters = allSetupAdapters();
  const detections = await Promise.all(adapters.map((adapter) => adapter.detect(runtime)));
  return adapters.map((adapter, index) => ({ adapter, detection: detections[index]! }));
}

export const PULSE_SETUP_PROMPT = SETUP_INSTRUCTION;
