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

/** Run an agent task behind clack's spinner. clack animates its own frames (liveness), so we only
 * re-render the label on a NEW tool action — no self-driven interval (that flooded terminals that
 * append instead of updating in place) and no streaming the model's prose into the label. With
 * `verbose`, every event still goes to stderr for a full peek. */
export async function withAgentProgress<T>(
  label: string,
  verbose: boolean,
  run: (onEvent: (e: DriverEvent) => void) => Promise<T>,
): Promise<T> {
  const s = ui.spinner();
  const t0 = Date.now();
  let lastLabel = "";

  s.start(label);
  try {
    return await run((e) => {
      if (verbose) log.debug(`[agent] ${e.kind}: ${e.message}`);
      if (e.kind !== "tool") return; // skip text/prose in the label
      const next = `${label} · ${short(e.message)}`;
      if (next !== lastLabel) {
        lastLabel = next;
        s.message(next);
      }
    });
  } finally {
    s.stop(`${label} · done in ${mmss(t0)}`);
  }
}
