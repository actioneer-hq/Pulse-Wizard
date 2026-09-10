import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Step } from "../flow/step.js";
import { withAgentProgress } from "../prompts/progress.js";
import { artifactDir, otlpPrompt, skillDir, validatorScript } from "../prompts/skills.js";
import * as ui from "../prompts/ui.js";
import { WizardError } from "../util/errors.js";
import { exec } from "../util/exec.js";

/** Drive the coding agent to generate a JSONata OTLP mapping from the producer's repo, validate it,
 * and register it with Pulse using the agent's ingest token. */
export const otlpJob: Step = {
  id: "otlp-job",
  title: "OTLP mapping",
  async run(ctx) {
    if (!ctx.driver) throw new WizardError("no coding agent selected");
    if (!ctx.pulse) throw new WizardError("not connected to Pulse");
    const { driver, pulse } = ctx;

    const skill = skillDir("pulse-otlp-mapping");
    const artifact = await artifactDir(ctx.repoPath, "otlp");

    await withAgentProgress("OTLP mapping", Boolean(ctx.flags.verbose), (onEvent) =>
      driver.run(otlpPrompt(skill, ctx.repoPath, artifact), {
        repo: ctx.repoPath,
        contextFiles: [artifact], // grant the agent write access to the artifact dir
        onEvent,
      }),
    );

    // Gate: re-validate the mapping ourselves before registering.
    const mapping = join(artifact, "mapping.jsonata");
    const sample = join(artifact, "sample-otlp.json");
    if (!existsSync(mapping)) throw new WizardError("agent did not produce mapping.jsonata");
    if (!existsSync(sample))
      throw new WizardError("agent did not produce sample-otlp.json to validate against");

    const val = await exec(
      "node",
      [
        validatorScript(skill),
        mapping,
        sample,
        join(artifact, "canonical-trace.json"),
        join(artifact, "coverage.json"),
      ],
      { cwd: artifact },
    );
    if (val.code !== 0) {
      throw new WizardError(
        `mapping failed validation:\n${(val.stdout || val.stderr).slice(-800)}`,
      );
    }

    const expression = await readFile(mapping, "utf8");
    const { version } = await pulse.putOtlpMapping(expression);
    ui.note(`Registered OTLP mapping (v${version}). Validation passed.`, "OTLP");

    // Best-effort: send the agent-inferred market use-case (+ framework/language) to Pulse.
    // Never fail onboarding over this.
    try {
      const meta = JSON.parse(await readFile(join(artifact, "integration.json"), "utf8"));
      await pulse.putAgentMeta({
        use_case: meta.use_case,
        framework: meta.framework,
        language: meta.language,
      });
    } catch {
      // no integration.json, or a transient error — skip silently
    }
  },
};
