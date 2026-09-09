import { NotImplementedError, WizardError } from "../util/errors.js";

/** Thin client for a running Pulse instance. Endpoints mirror the Pulse API
 * (e.g. `PUT /v1/agents/{id}/otlp-mapping` from the OTLP-mapping PR). Auth is the ingest/session
 * token the dev pastes during onboarding. Only `health()` is wired in P0; the rest are stubs. */
export class PulseClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.token}`,
    };
  }

  /** GET /health — used to validate the endpoint before anything else. */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(this.url("/health"));
      return res.ok;
    } catch (e) {
      throw new WizardError(`could not reach Pulse at ${this.baseUrl}: ${(e as Error).message}`);
    }
  }

  /** PUT /v1/agents/{agentId}/otlp-mapping — register the generated JSONata expression. */
  async putOtlpMapping(_agentId: string, _expression: string): Promise<{ version: number }> {
    throw new NotImplementedError("PulseClient.putOtlpMapping");
  }

  /** PUT /v1/agents/{agentId}/audio-config — register blob-storage + credentials. */
  async putBlobConfig(_agentId: string, _config: unknown): Promise<void> {
    throw new NotImplementedError("PulseClient.putBlobConfig");
  }
}
