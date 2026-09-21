import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newContext } from "../src/flow/context.js";
import { runFlow } from "../src/flow/run.js";
import { PulseClient } from "../src/pulse/client.js";

vi.mock("../src/prompts/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/prompts/ui.js")>()),
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
}));
vi.mock("../src/steps/selectAgent.js", () => ({
  selectAgent: { id: "select-agent", title: "Agent", run: async () => {} },
}));
vi.mock("../src/steps/otlp.js", () => ({
  otlpJob: {
    id: "otlp-job",
    title: "OTLP",
    run: async () => {
      throw new Error("missing capture");
    },
  },
}));
vi.mock("../src/steps/blob.js", () => ({
  blobJob: {
    id: "blob-job",
    title: "Storage",
    run: async (ctx: { artifacts: Record<string, unknown> }) => {
      ctx.artifacts.storage = "simulated";
    },
  },
}));

afterEach(() => {
  process.exitCode = 0;
});

describe("dev flow", () => {
  it("continues to storage after OTLP fails and reports incomplete", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-dev-flow-"));
    const ctx = newContext(repo, { dev: true, notify: false });

    await runFlow(ctx);

    expect(ctx.pulse).toBeInstanceOf(PulseClient);
    expect(ctx.artifacts["otlp-job"]).toMatch(/missing capture/);
    expect(ctx.artifacts.storage).toBe("simulated");
    expect(process.exitCode).toBe(1);
  });
});
