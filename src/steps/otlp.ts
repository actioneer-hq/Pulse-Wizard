import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Step } from "../flow/step.js";
import { withAgentProgress } from "../prompts/progress.js";
import {
  artifactDir,
  fixPrompt,
  otlpPrompt,
  skillDir,
  validatorScript,
} from "../prompts/skills.js";
import * as ui from "../prompts/ui.js";
import { WizardError } from "../util/errors.js";
import { exec } from "../util/exec.js";

const MAX_ATTEMPTS = 3; // 1 generate + up to 2 self-corrections

/** Drive the coding agent to generate a JSONata OTLP mapping from the producer's repo, validate it,
 * feed any validator errors back to the agent to fix (bounded), then register it with Pulse. */
export const otlpJob: Step = {
  id: "otlp-job",
  title: "OTLP mapping",
  async run(ctx) {
    if (!ctx.driver) throw new WizardError("no coding agent selected");
    if (!ctx.pulse) throw new WizardError("not connected to Pulse");
    const { driver, pulse } = ctx;

    const skill = skillDir("pulse-otlp-mapping");
    const artifact = await artifactDir(ctx.repoPath, "otlp");
    const mapping = join(artifact, "mapping.jsonata");
    const sample = join(artifact, "sample-otlp.json");
    const verbose = Boolean(ctx.flags.verbose);

    const validate = () =>
      exec(
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

    let report = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const label = attempt === 1 ? "OTLP mapping" : `OTLP mapping · fixing (${attempt - 1})`;
      const prompt =
        attempt === 1 ? otlpPrompt(skill, ctx.repoPath, artifact) : fixPrompt(mapping, report);
      await withAgentProgress(label, verbose, (onEvent) =>
        driver.run(prompt, { repo: ctx.repoPath, contextFiles: [artifact], onEvent }),
      );

      if (!existsSync(mapping) || !existsSync(sample)) {
        report =
          "The agent did not produce mapping.jsonata and sample-otlp.json in the artifact directory.";
      } else {
        const val = await validate();
        if (val.code === 0) {
          const expression = await readFile(mapping, "utf8");
          const { version } = await pulse.putOtlpMapping(expression);
          const fixes = attempt > 1 ? ` after ${attempt - 1} fix(es)` : "";
          ui.note(`Registered OTLP mapping (v${version}). Validation passed${fixes}.`, "OTLP");
          await sendAgentMeta(pulse, artifact);
          return;
        }
        report = (val.stdout || val.stderr).slice(-1200);
      }

      if (attempt === MAX_ATTEMPTS) {
        throw new WizardError(
          `mapping failed validation after ${MAX_ATTEMPTS} attempts:\n${report}`,
        );
      }
      ui.note(
        `Validation failed — asking the agent to fix it (try ${attempt + 1}/${MAX_ATTEMPTS})…`,
        "OTLP",
      );
    }
  },
};

/** Best-effort: send the agent-inferred market use-case (+ framework/language). Never fails onboarding. */
async function sendAgentMeta(
  pulse: { putAgentMeta(m: Record<string, string | undefined>): Promise<void> },
  artifact: string,
): Promise<void> {
  try {
    const meta = JSON.parse(await readFile(join(artifact, "integration.json"), "utf8"));
    await pulse.putAgentMeta({
      use_case: meta.use_case,
      framework: meta.framework,
      language: meta.language,
    });
  } catch {
    // no integration.json or a transient error — skip silently
  }
}
