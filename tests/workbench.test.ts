import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type WorkbenchCase = {
  id: string;
  framework: string;
  language: string;
  scenario: string;
  repository: string;
  commit: string;
  license: string;
  subdirectory?: string;
};

const manifest = JSON.parse(readFileSync(resolve("workbench/cases.json"), "utf8")) as {
  version: number;
  cases: WorkbenchCase[];
};

describe("workbench manifest", () => {
  it("contains valid, reproducible GitHub cases", () => {
    expect(manifest.version).toBe(1);
    expect(manifest.cases.length).toBeGreaterThanOrEqual(3);
    expect(new Set(manifest.cases.map((testCase) => testCase.id)).size).toBe(manifest.cases.length);

    for (const testCase of manifest.cases) {
      expect(testCase.id).toMatch(/^[a-z0-9-]+$/);
      expect(testCase.repository).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/);
      expect(testCase.commit).toMatch(/^[a-f0-9]{40}$/);
      expect(testCase.license).not.toHaveLength(0);
      expect(["existing-otlp", "framework-native-otlp", "needs-instrumentation"]).toContain(
        testCase.scenario,
      );
      if (testCase.subdirectory) expect(testCase.subdirectory).not.toMatch(/(^|\/)\.\.($|\/)/);
    }
  });

  it("lists every case without touching the network", () => {
    const output = execFileSync(
      process.execPath,
      [resolve("workbench/materialize.mjs"), "--list"],
      {
        encoding: "utf8",
      },
    );
    for (const testCase of manifest.cases) expect(output).toContain(testCase.id);
  });
});
