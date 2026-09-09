import { describe, expect, it } from "vitest";
import { allDrivers, detectAvailable } from "../src/drivers/registry.js";
import { newContext } from "../src/flow/context.js";

describe("driver registry", () => {
  it("lists the known drivers in order", () => {
    expect(allDrivers().map((d) => d.id)).toEqual(["claude-code", "codex", "acp"]);
  });

  it("detects installation status for every driver", async () => {
    const detected = await detectAvailable();
    expect(detected).toHaveLength(3);
    for (const d of detected) {
      expect(typeof d.installed).toBe("boolean");
    }
  });
});

describe("context", () => {
  it("seeds an empty artifacts bag and carries flags", () => {
    const ctx = newContext("/tmp/x", { job: "otlp" });
    expect(ctx.repoPath).toBe("/tmp/x");
    expect(ctx.job).toBeUndefined(); // flags carry it; steps set ctx.job
    expect(ctx.flags.job).toBe("otlp");
    expect(ctx.artifacts).toEqual({});
  });
});
