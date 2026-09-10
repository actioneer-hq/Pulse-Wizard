import { basename } from "node:path";
import type { DriverEvent } from "../drivers/types.js";
import { log } from "../util/log.js";
import * as ui from "./ui.js";

function mmss(t0: number): string {
  const s = Math.floor((Date.now() - t0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Shorten a tool event ("Write /a/b/c.json") to something spinner-sized ("Write c.json"). */
function short(message: string): string {
  const [tool, ...rest] = message.split(" ");
  const arg = rest.join(" ").trim();
  if (!arg) return tool ?? message;
  const tail = arg.includes("/") ? basename(arg) : arg;
  return `${tool} ${tail}`.slice(0, 60);
}

/** Run an agent task and show a live peek of its actions.
 *
 * clack's animated spinner only updates in place on a genuine TTY; in VS Code debug terminals,
 * piped output, or CI the frame loop appends instead, flooding the screen with one line per tick.
 * So we only animate when stdout is a real TTY. Otherwise we print a discrete line per NEW tool
 * action (deduped) — appending each exactly once, which can never flood. Either way a new label is
 * emitted only on a new action, and with `verbose` every event also goes to stderr. */
export async function withAgentProgress<T>(
  label: string,
  verbose: boolean,
  run: (onEvent: (e: DriverEvent) => void) => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  let last = "";
  const animate = Boolean(process.stdout.isTTY);
  const s = animate ? ui.spinner() : null;

  if (s) s.start(label);
  else ui.line(`${label}…`);
  try {
    return await run((e) => {
      if (verbose) log.debug(`[agent] ${e.kind}: ${e.message}`);
      if (e.kind !== "tool") return; // skip text/prose in the peek
      const next = short(e.message);
      if (next === last) return; // dedupe repeated actions
      last = next;
      if (s) s.message(`${label} · ${next}`);
      else ui.line(`  · ${next}`); // discrete, append-once line — flood-proof
    });
  } finally {
    const done = `${label} · done in ${mmss(t0)}`;
    if (s) s.stop(done);
    else ui.line(done);
  }
}
