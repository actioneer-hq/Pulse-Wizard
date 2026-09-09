import type { WizardContext } from "./context.js";

/** One stage of the guided flow. Steps mutate the shared context. `skip` lets a step opt out
 * (e.g. the blob step when the OTLP job was chosen). */
export interface Step {
  readonly id: string;
  readonly title: string;
  skip?(ctx: WizardContext): boolean;
  run(ctx: WizardContext): Promise<void>;
}
