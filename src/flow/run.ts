import { saveSession } from "../config/session.js";
import * as ui from "../prompts/ui.js";
import { blobJob } from "../steps/blob.js";
import { connectPulse } from "../steps/connectPulse.js";
import { otlpJob } from "../steps/otlp.js";
import { outro } from "../steps/outro.js";
import { selectAgent } from "../steps/selectAgent.js";
import { WizardError } from "../util/errors.js";
import { log } from "../util/log.js";
import type { WizardContext } from "./context.js";
import type { Step } from "./step.js";

/** The guided flow, in order. Adding a stage = adding a Step here. */
const STEPS: Step[] = [selectAgent, connectPulse, otlpJob, blobJob, outro];

export async function runFlow(ctx: WizardContext): Promise<void> {
  ui.intro("Pulse Wizard");
  try {
    for (const step of STEPS) {
      if (step.skip?.(ctx)) continue;
      log.debug(`step: ${step.id}`);
      await step.run(ctx);
    }
    await saveSession(ctx.repoPath, {
      pulseUrl: ctx.pulseUrl,
      driverId: ctx.driver?.id,
    });
  } catch (e) {
    if (e instanceof WizardError) {
      log.error(e.message);
      process.exit(1);
    }
    throw e; // unexpected → let it surface with a stack
  }
}
