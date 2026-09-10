import * as p from "@clack/prompts";
import pc from "picocolors";

/** Thin wrapper over @clack/prompts so steps don't import clack directly and cancellation is
 * handled in one place. */

export function intro(title: string): void {
  p.intro(pc.bgCyan(pc.black(` ${title} `)));
}

export function outro(msg: string): void {
  p.outro(msg);
}

export function note(msg: string, title?: string): void {
  p.note(msg, title);
}

/** Append one plain line in clack's gutter style. Used for flood-proof progress on non-TTY stdout
 * (VS Code debug terminals, pipes, CI) where the animated spinner would print a line per frame. */
export function line(msg: string): void {
  process.stdout.write(`${pc.gray("│")}  ${pc.dim(msg)}\n`);
}

export function spinner() {
  return p.spinner();
}

/** Bail out cleanly on Ctrl-C / Esc. clack returns a cancel symbol; we centralize the exit. */
function guard<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(130);
  }
  return value as T;
}

export async function select<T>(opts: {
  message: string;
  options: { value: T; label: string; hint?: string }[];
}): Promise<T> {
  return guard(await p.select(opts as never)) as T;
}

export async function text(opts: {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: (v: string) => string | undefined;
}): Promise<string> {
  return guard(await p.text(opts));
}

export async function password(opts: { message: string }): Promise<string> {
  return guard(await p.password(opts));
}
