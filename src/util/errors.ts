/** Thrown by the many P0 stubs so the flow compiles and boots before bodies exist. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`not implemented yet: ${what}`);
    this.name = "NotImplementedError";
  }
}

/** A user-facing failure the flow should surface cleanly (not a bug/stack trace). */
export class WizardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WizardError";
  }
}
