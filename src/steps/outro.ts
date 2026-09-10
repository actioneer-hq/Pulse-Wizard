import type { Step } from "../flow/step.js";
import * as ui from "../prompts/ui.js";

export const outro: Step = {
  id: "outro",
  title: "Done",
  async run() {
    ui.outro(
      "All set. Your agent is wired into Pulse — send it some traffic and watch the calls roll in.",
    );
  },
};
