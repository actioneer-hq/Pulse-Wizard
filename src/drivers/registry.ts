import { AcpDriver } from "./acp.js";
import { ClaudeCodeDriver } from "./claudeCode.js";
import { CodexDriver } from "./codex.js";
import type { Driver } from "./types.js";

/** All drivers the wizard knows about, in preferred display order. The ACP driver covers every
 * ACP-native agent (opencode/Grok/future) and doubles as the bundled fallback. */
export function allDrivers(): Driver[] {
  return [new ClaudeCodeDriver(), new CodexDriver(), new AcpDriver()];
}

export interface DetectedDriver {
  driver: Driver;
  installed: boolean;
}

/** Probe every known driver for installation. Selection UI shows installed ones first. */
export async function detectAvailable(): Promise<DetectedDriver[]> {
  const drivers = allDrivers();
  const installed = await Promise.all(drivers.map((d) => d.detect()));
  return drivers.map((driver, i) => ({ driver, installed: installed[i] ?? false }));
}
