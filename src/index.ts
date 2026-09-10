import { resolve } from "node:path";
import { newContext } from "./flow/context.js";
import type { CliFlags } from "./flow/context.js";
import { runFlow } from "./flow/run.js";
import { setVerbose } from "./util/log.js";

/** Programmatic entry. `cli.ts` parses argv into flags and calls this. */
export async function run(flags: CliFlags = {}): Promise<void> {
  setVerbose(Boolean(flags.verbose));
  // Absolute path: the agent runs with cwd=repo and we pass artifact paths into its prompt; a relative
  // repo would resolve differently for the agent vs the wizard (files land in the wrong place).
  const repoPath = resolve(flags.repo ?? process.cwd());
  const ctx = newContext(repoPath, flags);
  await runFlow(ctx);
}

export type { CliFlags } from "./flow/context.js";
