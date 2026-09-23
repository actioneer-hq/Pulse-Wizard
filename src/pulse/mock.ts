import { createServer } from "node:http";
import type { IntegrationManifest } from "../integration/manifest.js";
import { validateManifest } from "../integration/manifest.js";
import type { PulseApi } from "./client.js";

export class MockPulseClient implements PulseApi {
  readonly integrationManifests: IntegrationManifest[] = [];

  async health(): Promise<boolean> {
    return true;
  }

  async putIntegrationManifest(manifest: IntegrationManifest): Promise<void> {
    this.integrationManifests.push(structuredClone(validateManifest(manifest)));
  }
}

export const LOCAL_MOCK_TOKEN = "pulse-local-mock";

export async function startMockPulseServer(): Promise<{
  url: string;
  state: MockPulseClient;
  close: () => Promise<void>;
}> {
  const state = new MockPulseClient();
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    void (async () => {
      if (request.method === "GET" && request.url === "/health") {
        send(200, { status: "ok" });
        return;
      }
      if (request.method !== "PUT" || request.url !== "/v1/ingest/integration-manifest") {
        send(404, { detail: "unknown endpoint" });
        return;
      }
      if (request.headers.authorization !== `Bearer ${LOCAL_MOCK_TOKEN}`) {
        send(401, { detail: "missing local token" });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 10_000_000) throw new Error("request too large");
        chunks.push(Buffer.from(chunk));
      }
      const manifest = validateManifest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      await state.putIntegrationManifest(manifest);
      send(200, {});
    })().catch((error: Error) => send(400, { detail: error.message }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("local Pulse mock did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    state,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
