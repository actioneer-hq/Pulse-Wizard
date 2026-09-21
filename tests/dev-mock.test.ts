import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newContext } from "../src/flow/context.js";
import * as ui from "../src/prompts/ui.js";
import { PulseClient } from "../src/pulse/client.js";
import { connectPulse } from "../src/steps/connectPulse.js";

vi.mock("../src/prompts/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/prompts/ui.js")>()),
  note: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("dev Pulse mock", () => {
  it("connects to loopback without asking for credentials", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-dev-connect-"));
    const ctx = newContext(repo, { dev: true });

    try {
      await connectPulse.run(ctx);

      expect(ctx.pulse).toBeInstanceOf(PulseClient);
      expect(await ctx.pulse?.health()).toBe(true);
      expect(ctx.token).toBeUndefined();
      expect(ctx.pulseUrl).toBeUndefined();
      expect(ui.text).not.toHaveBeenCalled();
      expect(ui.password).not.toHaveBeenCalled();
    } finally {
      await ctx.closePulse?.();
    }
  });
});
