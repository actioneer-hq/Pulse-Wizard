import { spawn } from "node:child_process";

export interface ExecOptions {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** Called with each chunk of stdout as it streams (for progress parsing). */
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Spawn a command, capture (and optionally stream) its output. Never throws on non-zero exit —
 * the caller inspects `code`. Rejects only if the process fails to spawn. */
export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      opts.onStderr?.(s);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

/** Is a binary on PATH? Used by driver `detect()`. */
export async function commandExists(cmd: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const { code } = await exec(probe, [cmd]);
    return code === 0;
  } catch {
    return false;
  }
}
