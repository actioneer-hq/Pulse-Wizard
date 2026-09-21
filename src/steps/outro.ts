import type { Step } from "../flow/step.js";
import * as ui from "../prompts/ui.js";

export const outro: Step = {
  id: "outro",
  title: "Done",
  async run(ctx) {
    const incomplete =
      ctx.artifacts.storage === "not_found" ||
      ctx.artifacts.storage === "ignored" ||
      Object.keys(ctx.artifacts).some(
        (key) => key.endsWith("-job") && String(ctx.artifacts[key]).startsWith("incomplete"),
      );
    ui.outro(
      ctx.flags.dev
        ? incomplete
          ? "Local run incomplete. Review the reported errors; nothing was sent to Pulse."
          : "Local validation and mock registration complete. Nothing was sent to Pulse."
        : incomplete
          ? "Setup incomplete. Review the missing storage findings."
          : "Setup complete. Validated mappings were registered with Pulse.",
    );
  },
};
