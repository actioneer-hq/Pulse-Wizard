export type SetupAdapterId =
  | "claude-code"
  | "codex"
  | "opencode"
  | "cursor-agent"
  | "gemini-cli"
  | "cursor-ide"
  | "windsurf";

export interface LaunchTarget {
  command: string;
  argsPrefix?: string[];
}

export interface AdapterDetection {
  available: boolean;
  target?: LaunchTarget;
}

export interface GeneratedSupportFile {
  path: string;
  content: string;
}

export interface AdapterContext {
  repo: string;
  prompt: string;
}

export interface LaunchResult {
  code?: number;
  waitsForExit: boolean;
}

export interface AdapterRuntime {
  readonly platform: NodeJS.Platform;
  commandExists(command: string): Promise<boolean>;
  pathExists(path: string): Promise<boolean>;
  run(command: string, args: string[], options: { cwd: string; inherit: boolean }): Promise<number>;
}

export interface SetupAdapter {
  readonly id: SetupAdapterId;
  readonly label: string;
  readonly kind: "terminal" | "ide";
  detect(runtime: AdapterRuntime): Promise<AdapterDetection>;
  supportFiles(context: AdapterContext): GeneratedSupportFile[];
  launch(
    context: AdapterContext,
    detection: AdapterDetection,
    runtime: AdapterRuntime,
  ): Promise<LaunchResult>;
  nextStep?: string;
}

export interface DetectedAdapter {
  adapter: SetupAdapter;
  detection: AdapterDetection;
}
