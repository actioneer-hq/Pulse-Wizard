import { afterEach, describe, expect, it, vi } from "vitest";
import { PulseClient } from "../src/pulse/client.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(ok: boolean, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok,
      status: ok ? 200 : 422,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  return calls;
}

describe("PulseClient", () => {
  it("PUTs the mapping to /v1/ingest with token + org headers", async () => {
    const calls = stubFetch(true, { version: 3 });
    const res = await new PulseClient("http://pulse/", "vo_tok", "acme").putOtlpMapping("EXPR");

    expect(res.version).toBe(3);
    const { url, init } = calls[0]!;
    expect(url).toBe("http://pulse/v1/ingest/otlp-mapping");
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer vo_tok");
    expect(headers["x-voiceobs-org"]).toBe("acme");
    expect(JSON.parse(init.body as string)).toEqual({ expression: "EXPR" });
  });

  it("posts storage config to /v1/ingest/storage-config", async () => {
    const calls = stubFetch(true, {});
    await new PulseClient("http://pulse", "t").putBlobConfig({ provider: "s3_compatible" });
    expect(calls[0]!.url).toBe("http://pulse/v1/ingest/storage-config");
  });

  it("throws a WizardError on a non-ok response", async () => {
    stubFetch(false, { detail: "nope" });
    await expect(new PulseClient("http://pulse", "t").putOtlpMapping("x")).rejects.toThrow(/422/);
  });
});
