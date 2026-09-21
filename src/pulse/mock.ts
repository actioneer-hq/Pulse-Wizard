import { createServer } from "node:http";
import type { PulseApi } from "./client.js";

type AgentMeta = Parameters<PulseApi["putAgentMeta"]>[0];

/** State backing the local Pulse test server. */
export class MockPulseClient implements PulseApi {
  readonly mappings: string[] = [];
  readonly jsonLogMappings: {
    expression: string;
    storage_rule_id: string;
    sample_origin: string;
  }[] = [];
  readonly storageManifests: unknown[] = [];
  readonly agentMeta: AgentMeta[] = [];

  async health(): Promise<boolean> {
    return true;
  }

  async putOtlpMapping(expression: string): Promise<{ version: number }> {
    this.mappings.push(expression);
    return { version: this.mappings.length };
  }

  async putJsonLogMapping(mapping: {
    expression: string;
    storage_rule_id: string;
    sample_origin: string;
  }): Promise<{ version: number }> {
    this.jsonLogMappings.push({ ...mapping });
    return { version: this.jsonLogMappings.length };
  }

  async putStorageManifest(manifest: unknown): Promise<void> {
    this.storageManifests.push(structuredClone(manifest));
  }

  async putAgentMeta(meta: AgentMeta): Promise<void> {
    this.agentMeta.push({ ...meta });
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
      if (request.method !== "PUT") {
        send(405, { detail: "method not allowed" });
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
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("expected JSON object");
      }
      const payload = body as Record<string, unknown>;
      switch (request.url) {
        case "/v1/ingest/otlp-mapping":
          if (typeof payload.expression !== "string") throw new Error("expression is required");
          send(200, await state.putOtlpMapping(payload.expression));
          return;
        case "/v1/ingest/json-log-mapping":
          if (
            typeof payload.expression !== "string" ||
            typeof payload.storage_rule_id !== "string" ||
            typeof payload.sample_origin !== "string"
          ) {
            throw new Error("invalid JSON log mapping");
          }
          send(
            200,
            await state.putJsonLogMapping({
              expression: payload.expression,
              storage_rule_id: payload.storage_rule_id,
              sample_origin: payload.sample_origin,
            }),
          );
          return;
        case "/v1/ingest/storage-manifest":
          await state.putStorageManifest(body);
          send(200, {});
          return;
        case "/v1/ingest/agent-meta":
          await state.putAgentMeta(payload);
          send(200, {});
          return;
        default:
          send(404, { detail: "unknown endpoint" });
      }
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
