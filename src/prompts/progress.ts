import type { DriverEvent } from "../drivers/types.js";
import { log } from "../util/log.js";
import * as ui from "./ui.js";

function mmss(t0: number): string {
  const s = Math.floor((Date.now() - t0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Run an agent task behind a spinner that ticks every second with elapsed time + the last activity,
 * so a long autonomous run reads as alive rather than hung. With `verbose`, every agent event is also
 * streamed to stderr for a full peek at what it's doing. */
export async function withAgentProgress<T>(
  label: string,
  verbose: boolean,
  run: (onEvent: (e: DriverEvent) => void) => Promise<T>,
): Promise<T> {
  const s = ui.spinner();
  const t0 = Date.now();
  let last = "starting…";
  const render = () => s.message(`${label} · ${last} · ${mmss(t0)}`);

  s.start(`${label} · ${mmss(t0)}`);
  const timer = setInterval(render, 1000);
  try {
    return await run((e) => {
      last = e.message.length > 72 ? `${e.message.slice(0, 72)}…` : e.message;
      if (verbose) log.debug(`[agent] ${e.kind}: ${e.message}`);
    });
  } finally {
    clearInterval(timer);
    s.stop(`${label} · done in ${mmss(t0)}`);
  }
}
