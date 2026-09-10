import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("OTLP mapping validator", () => {
  it("evaluates JSONata and reports canonical metric coverage", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-mapping-"));
    const trace = join(dir, "trace.json");
    const coverage = join(dir, "coverage.json");

    try {
      execFileSync(
        process.execPath,
        [
          resolve("src/skills/pulse-otlp-mapping/scripts/validate-mapping.mjs"),
          resolve("tests/fixtures/minimal-mapping.jsonata"),
          resolve("tests/fixtures/minimal-otlp.json"),
          trace,
          coverage,
        ],
        { stdio: "pipe" },
      );

      const mapped = JSON.parse(readFileSync(trace, "utf8"));
      const report = JSON.parse(readFileSync(coverage, "utf8"));
      expect(mapped.header.call_id).toBe("trace-1");
      expect(
        mapped.spans.find((span: { stage: string }) => span.stage === "llm").attrs,
      ).toMatchObject({ "metrics.ttft": 0.2, "gen_ai.usage.output_tokens": 12 });
      expect(report.errors).toEqual([]);
      expect(report.coverage.llm_ttft.status).toBe("degraded");
      expect(report.coverage.transcript.status).toBe("available");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
