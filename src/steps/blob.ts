import type { Step } from "../flow/step.js";
import * as ui from "../prompts/ui.js";

/** Blob-storage job (STUB). Later: collect provider + descriptor + credentials (structured), then
 * PUT to Pulse's audio-config endpoint. No coding agent involved. */
export const blobJob: Step = {
  id: "blob-job",
  title: "Audio storage",
  async run(ctx) {
    ui.note(
      [
        "Audio-storage setup is not implemented yet.",
        `pulse:  ${ctx.pulseUrl ?? "(none)"}`,
        "",
        "Next: collect S3/Azure descriptor + credentials → register with Pulse.",
      ].join("\n"),
      "Blob storage (stub)",
    );
  },
};
