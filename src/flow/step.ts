import type { WizardContext } from "./context.js";

/** One stage of the guided flow. Steps mutate the shared context. */
export interface Step {
  readonly id: string;
  readonly title: string;
  skip?(ctx: WizardContext): boolean;
  run(ctx: WizardContext): Promise<void>;
}
