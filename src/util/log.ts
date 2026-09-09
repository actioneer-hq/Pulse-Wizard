import pc from "picocolors";

type Level = "debug" | "info" | "warn" | "error";

let verbose = false;
export function setVerbose(on: boolean): void {
  verbose = on;
}

function emit(level: Level, msg: string): void {
  if (level === "debug" && !verbose) return;
  const tag = {
    debug: pc.dim("debug"),
    info: pc.cyan("info"),
    warn: pc.yellow("warn"),
    error: pc.red("error"),
  }[level];
  // stderr so structured stdout (if any) stays clean
  process.stderr.write(`${tag} ${msg}\n`);
}

export const log = {
  debug: (m: string) => emit("debug", m),
  info: (m: string) => emit("info", m),
  warn: (m: string) => emit("warn", m),
  error: (m: string) => emit("error", m),
};
