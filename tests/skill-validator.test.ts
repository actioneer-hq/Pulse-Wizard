import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("accepts arbitrary call-linked JSON in json_log mode but not OTLP mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-json-log-"));
    const script = resolve("src/skills/pulse-otlp-mapping/scripts/validate-mapping.mjs");
    const mapping = resolve("tests/fixtures/minimal-json-log-mapping.jsonata");
    const sample = resolve("tests/fixtures/minimal-json-log.json");
    const trace = join(dir, "trace.json");
    const coverage = join(dir, "coverage.json");
    try {
      execFileSync(process.execPath, [script, mapping, sample, trace, coverage, "json_log"]);
      expect(JSON.parse(readFileSync(trace, "utf8")).header.call_id).toBe("call-7");
      expect(JSON.parse(readFileSync(coverage, "utf8")).errors).toEqual([]);
      expect(() => execFileSync(process.execPath, [script, mapping, sample])).toThrow();
      const invalid = join(dir, "invalid.jsonata");
      writeFileSync(invalid, "{}\n");
      expect(() =>
        execFileSync(process.execPath, [script, invalid, sample, trace, coverage, "json_log"]),
      ).toThrow();
      expect(JSON.parse(readFileSync(coverage, "utf8")).errors).toContain(
        "header must be an object",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
