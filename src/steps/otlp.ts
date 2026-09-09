import type { Step } from "../flow/step.js";
import * as ui from "../prompts/ui.js";

/** OTLP mapping job (STUB). Later: capture sample spans → inject the SKILL + canonical spec → drive
 * the chosen agent to generate a JSONata mapping → validate locally → register with Pulse. */
export const otlpJob: Step = {
  id: "otlp-job",
  title: "OTLP mapping",
  skip: (ctx) => ctx.job !== "otlp",
  async run(ctx) {
    ui.note(
      [
        "OTLP mapping is not implemented yet.",
        `agent:  ${ctx.driver?.label ?? "(none)"}`,
        `pulse:  ${ctx.pulseUrl ?? "(none)"}`,
        `repo:   ${ctx.repoPath}`,
        "",
        "Next: capture samples → agent generates JSONata → validate → register.",
      ].join("\n"),
      "OTLP (stub)",
    );
  },
};
