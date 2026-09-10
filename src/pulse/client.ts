import { WizardError } from "../util/errors.js";

/** Thin client for a running Pulse instance. Registration uses the agent's ingest token against the
 * token-authenticated `/v1/ingest/*` endpoints — the token identifies the agent, so no agent_id or
 * admin login is needed. */
export class PulseClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly org = "default",
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
      "x-voiceobs-org": this.org,
    };
  }

  private async put(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new WizardError(`could not reach Pulse at ${this.baseUrl}: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new WizardError(`Pulse ${path} → ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.json().catch(() => ({}));
  }

  /** GET /health — validate the endpoint before anything else. */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(this.url("/health"));
      return res.ok;
    } catch (e) {
      throw new WizardError(`could not reach Pulse at ${this.baseUrl}: ${(e as Error).message}`);
    }
  }

  /** PUT /v1/ingest/otlp-mapping — register the generated JSONata expression for this token's agent. */
  async putOtlpMapping(expression: string): Promise<{ version: number }> {
    return (await this.put("/v1/ingest/otlp-mapping", { expression })) as { version: number };
  }

  /** PUT /v1/ingest/storage-config — register blob-storage + credentials for this token's agent. */
  async putBlobConfig(config: unknown): Promise<void> {
    await this.put("/v1/ingest/storage-config", config);
  }
}
