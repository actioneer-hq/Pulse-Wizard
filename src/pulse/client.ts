import type { IntegrationManifest } from "../integration/manifest.js";
import { WizardError } from "../util/errors.js";

export interface PulseApi {
  health(): Promise<boolean>;
  putIntegrationManifest(manifest: IntegrationManifest): Promise<void>;
}

export class PulseClient implements PulseApi {
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

  async health(): Promise<boolean> {
    try {
      return (await fetch(this.url("/health"))).ok;
    } catch (error) {
      throw new WizardError(
        `could not reach Pulse at ${this.baseUrl}: ${(error as Error).message}`,
      );
    }
  }

  async putIntegrationManifest(manifest: IntegrationManifest): Promise<void> {
    let response: Response;
    const path = "/v1/ingest/integration-manifest";
    try {
      response = await fetch(this.url(path), {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
          "x-voiceobs-org": this.org,
        },
        body: JSON.stringify(manifest),
      });
    } catch (error) {
      throw new WizardError(
        `could not reach Pulse at ${this.baseUrl}: ${(error as Error).message}`,
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new WizardError(`Pulse ${path} -> ${response.status}: ${detail.slice(0, 300)}`);
    }
  }
}
