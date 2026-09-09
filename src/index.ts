import { newContext } from "./flow/context.js";
import type { CliFlags } from "./flow/context.js";
import { runFlow } from "./flow/run.js";
import { setVerbose } from "./util/log.js";

/** Programmatic entry. `cli.ts` parses argv into flags and calls this. */
export async function run(flags: CliFlags = {}): Promise<void> {
  setVerbose(Boolean(flags.verbose));
  const repoPath = flags.repo ?? process.cwd();
  const ctx = newContext(repoPath, flags);
  await runFlow(ctx);
}

export type { CliFlags } from "./flow/context.js";
