import { detectAvailable } from "../drivers/registry.js";
import type { Step } from "../flow/step.js";
import * as ui from "../prompts/ui.js";

/** "Which coding agent do you use?" — detect what's installed, let the dev pick. The chosen Driver
 * is how the wizard will later generate the mapping / edit code. */
export const selectAgent: Step = {
  id: "select-agent",
  title: "Choose coding agent",
  async run(ctx) {
    const detected = await detectAvailable();

    // flag override: --agent <id>
    if (ctx.flags.agent) {
      const match = detected.find((d) => d.driver.id === ctx.flags.agent);
      if (match) {
        ctx.driver = match.driver;
        return;
      }
    }

    const id = await ui.select({
      message: "Which coding agent should the wizard drive?",
      options: detected.map((d) => ({
        value: d.driver.id,
        label: d.driver.label,
        hint: d.installed ? "detected" : "not detected",
      })),
    });

    const chosen = detected.find((d) => d.driver.id === id);
    if (chosen && !chosen.installed) {
      ui.note(
        `${chosen.driver.label} isn't detected on PATH. Install it and log in, then re-run.`,
        "Heads up",
      );
    }
    ctx.driver = chosen?.driver;
  },
};
