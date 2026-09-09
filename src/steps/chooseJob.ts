import type { JobKind } from "../flow/context.js";
import type { Step } from "../flow/step.js";
import * as ui from "../prompts/ui.js";

/** Pick what to set up: OTLP mapping (spans) or blob storage (audio). */
export const chooseJob: Step = {
  id: "choose-job",
  title: "Choose what to set up",
  async run(ctx) {
    if (ctx.flags.job) {
      ctx.job = ctx.flags.job;
      return;
    }
    ctx.job = await ui.select<JobKind>({
      message: "What do you want to set up?",
      options: [
        {
          value: "otlp",
          label: "OTLP telemetry",
          hint: "map your spans → Pulse, see call metrics",
        },
        {
          value: "blob",
          label: "Audio storage",
          hint: "point Pulse at your recordings (S3/Azure)",
        },
      ],
    });
  },
};
