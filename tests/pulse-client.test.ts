import { afterEach, describe, expect, it, vi } from "vitest";
import { PulseClient } from "../src/pulse/client.js";
import { manifest } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

describe("PulseClient", () => {
  it("registers the unified manifest with token and org headers", async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      return new Response("{}", { status: 200 });
    });
    await new PulseClient("https://pulse.example/", "token", "acme").putIntegrationManifest(
      manifest(),
    );
    expect(calls[0]?.url).toBe("https://pulse.example/v1/ingest/integration-manifest");
    expect(calls[0]?.options.method).toBe("PUT");
    expect(calls[0]?.options.headers).toMatchObject({
      authorization: "Bearer token",
      "x-voiceobs-org": "acme",
    });
  });
});
