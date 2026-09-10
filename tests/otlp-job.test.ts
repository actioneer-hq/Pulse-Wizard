import { copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { newContext } from "../src/flow/context.js";
import { otlpJob } from "../src/steps/otlp.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "fixtures");

describe("otlpJob orchestration", () => {
  it("runs the agent, validates the mapping, and registers it", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-otlp-"));
    const artifact = join(repo, ".pulse", "artifacts", "otlp");

    // fake driver: emulate the agent by dropping the fixture deliverables into the artifact dir
    const driver = {
      id: "claude-code",
      label: "fake",
      detect: async () => true,
      authed: async () => true,
      run: async () => {
        await mkdir(artifact, { recursive: true });
        await copyFile(join(FIX, "minimal-mapping.jsonata"), join(artifact, "mapping.jsonata"));
        await copyFile(join(FIX, "minimal-otlp.json"), join(artifact, "sample-otlp.json"));
        return { text: "done", filesEdited: [] };
      },
    };

    let registered: string | null = null;
    const pulse = {
      putOtlpMapping: async (expression: string) => {
        registered = expression;
        return { version: 1 };
      },
    };

    const ctx = newContext(repo, {});
    // biome-ignore lint/suspicious/noExplicitAny: minimal fakes for the driver/pulse seams
    ctx.driver = driver as any;
    // biome-ignore lint/suspicious/noExplicitAny: minimal fakes for the driver/pulse seams
    ctx.pulse = pulse as any;

    await otlpJob.run(ctx);

    expect(registered).not.toBeNull();
    const expr = await readFile(join(FIX, "minimal-mapping.jsonata"), "utf8");
    expect(registered).toBe(expr); // the validated mapping was sent verbatim
  });
});
