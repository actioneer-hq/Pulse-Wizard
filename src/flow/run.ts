import { saveSession } from "../config/session.js";
import * as ui from "../prompts/ui.js";
import { blobJob } from "../steps/blob.js";
import { connectPulse } from "../steps/connectPulse.js";
import { otlpJob } from "../steps/otlp.js";
import { outro } from "../steps/outro.js";
import { selectAgent } from "../steps/selectAgent.js";
import { WizardError } from "../util/errors.js";
import { log } from "../util/log.js";
import { notify } from "../util/notify.js";
import type { WizardContext } from "./context.js";
import type { Step } from "./step.js";

/** The guided flow, in order. Adding a stage = adding a Step here. */
const STEPS: Step[] = [selectAgent, connectPulse, otlpJob, blobJob, outro];

export async function runFlow(ctx: WizardContext): Promise<void> {
  ui.intro("Pulse Wizard");
  try {
    if (process.stdin.isTTY && ctx.flags.notify === undefined) {
      ctx.flags.notify = await ui.select<boolean>({
        message: "Notify you when the wizard needs attention or finishes?",
        options: [
          { value: false, label: "No" },
          { value: true, label: "Yes" },
        ],
      });
    }
    for (const step of STEPS) {
      if (step.skip?.(ctx)) continue;
      log.debug(`step: ${step.id}`);
      if (ctx.flags.dev && (step.id === "otlp-job" || step.id === "blob-job")) {
        try {
          await step.run(ctx);
        } catch (e) {
          ctx.artifacts[step.id] = `incomplete: ${(e as Error).message}`;
          ui.note((e as Error).message, `${step.title} incomplete`);
        }
      } else {
        await step.run(ctx);
      }
    }
    await saveSession(ctx.repoPath, {
      pulseUrl: ctx.pulseUrl,
      driverId: ctx.driver?.id,
    });
    const incomplete =
      ctx.artifacts.storage === "not_found" ||
      ctx.artifacts.storage === "ignored" ||
      Object.keys(ctx.artifacts).some((key) => key.endsWith("-job"));
    if (incomplete) process.exitCode = 1;
    await notify(
      Boolean(ctx.flags.notify),
      "Pulse Wizard",
      incomplete ? "Setup needs attention" : "Setup finished",
    );
  } catch (e) {
    await notify(Boolean(ctx.flags.notify), "Pulse Wizard", "Setup failed");
    if (e instanceof WizardError) {
      log.error(e.message);
      process.exitCode = 1;
      return;
    }
    throw e; // unexpected → let it surface with a stack
  } finally {
    await ctx.closePulse?.();
  }
}
