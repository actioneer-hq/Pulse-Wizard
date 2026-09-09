import type { Step } from "../flow/step.js";
import * as ui from "../prompts/ui.js";

export const outro: Step = {
  id: "outro",
  title: "Done",
  async run() {
    ui.outro("All set — that's the skeleton for now. More coming soon.");
  },
};
