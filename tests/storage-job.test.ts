import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newContext } from "../src/flow/context.js";
import * as ui from "../src/prompts/ui.js";
import { MockPulseClient } from "../src/pulse/mock.js";
import { blobJob } from "../src/steps/blob.js";

vi.mock("../src/prompts/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/prompts/ui.js")>()),
  note: vi.fn(),
  select: vi.fn(),
}));

describe("storage discovery", () => {
  beforeEach(() => vi.clearAllMocks());
  it("requires confirmation when the agent finds no storage", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-no-storage-"));
    const artifact = join(repo, ".pulse", "artifacts", "storage");
    vi.mocked(ui.select).mockResolvedValueOnce("confirm");
    const ctx = newContext(repo, { dev: true });
    ctx.pulse = new MockPulseClient();
    ctx.driver = {
      id: "codex",
      label: "fake",
      detect: async () => true,
      authed: async () => true,
      run: async () => {
        await writeFile(
          join(artifact, "storage-draft.json"),
          JSON.stringify({ status: "no_storage", reason: "no upload code" }),
        );
        return { text: "done", filesEdited: [] };
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test driver
    } as any;
    await blobJob.run(ctx);
    expect(ui.select).toHaveBeenCalledOnce();
    expect(ctx.artifacts.storage).toBe("not_found");
  });

  it("reviews source-derived rules and saves a clean manifest in dev mode", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-storage-"));
    const artifact = join(repo, ".pulse", "artifacts", "storage");
    const draft = {
      manifest: {
        version: 1,
        sources: [
          {
            id: "recordings",
            provider: "s3_compatible",
            bucket: "voice",
            prefix: "calls/",
            rules: [
              {
                id: "audio",
                path_regex: "^calls/([^/]+)/audio$",
                role: "recording",
                decoder: "audio",
                call_id: { from: "object_path", group: 1 },
              },
            ],
          },
        ],
      },
      evidence: {
        audio: { source: "src/upload.ts:12", reason: "upload key", certainty: "proven" },
      },
      unresolved: [],
    };
    vi.mocked(ui.select).mockResolvedValueOnce("confirm");
    const ctx = newContext(repo, { dev: true });
    const pulse = new MockPulseClient();
    ctx.pulse = pulse;
    ctx.driver = {
      id: "codex",
      label: "fake",
      detect: async () => true,
      authed: async () => true,
      run: async () => {
        await writeFile(join(artifact, "storage-draft.json"), JSON.stringify(draft));
        return { text: "done", filesEdited: [] };
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test driver
    } as any;
    await blobJob.run(ctx);
    const final = JSON.parse(await readFile(join(artifact, "storage-manifest.json"), "utf8"));
    expect(ui.select).toHaveBeenCalledOnce();
    expect(final).toEqual(draft.manifest);
    expect(final.evidence).toBeUndefined();
    expect(ctx.artifacts.storage).toBe("simulated");
    expect(pulse.storageManifests).toEqual([draft.manifest]);
  });
});
