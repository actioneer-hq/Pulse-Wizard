import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { localCommand } from "../src/commands/local.js";

describe("JSON log mapping flow", () => {
  it("validates and simulates registration without Pulse", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-json-log-"));
    const artifact = join(repo, ".pulse/artifacts/otlp");
    await mkdir(artifact, { recursive: true });
    await writeFile(
      join(repo, ".pulse/config.json"),
      JSON.stringify({ dev: true, org: "default" }),
    );
    await copyFile(
      resolve("tests/fixtures/minimal-json-log-mapping.jsonata"),
      join(artifact, "mapping.jsonata"),
    );
    await copyFile(
      resolve("tests/fixtures/minimal-json-log.json"),
      join(artifact, "sample-json-log.json"),
    );
    await writeFile(
      join(artifact, "mapping-source.json"),
      JSON.stringify({
        source_kind: "json_log",
        sample_origin: "source_derived",
        storage_rule_id: "call-events",
      }),
    );
    const storage = join(repo, ".pulse/artifacts/storage");
    await mkdir(storage, { recursive: true });
    await writeFile(
      join(storage, "storage-manifest.json"),
      JSON.stringify({
        version: 1,
        sources: [
          {
            id: "logs",
            provider: "s3_compatible",
            bucket: "calls",
            prefix: "calls/",
            rules: [
              {
                id: "call-events",
                path_regex: "^calls/([^/]+)/events\\.json$",
                role: "call_events",
                kind: "log",
                decoder: "json",
                call_id: { from: "object_path", group: 1 },
              },
            ],
          },
        ],
      }),
    );
    const realFetch = globalThis.fetch;
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
        requests.push(url);
        return realFetch(input, init);
      }),
    );
    try {
      await localCommand("validate-trace-mapping", repo);
      expect(JSON.parse(await readFile(join(artifact, "coverage.json"), "utf8")).errors).toEqual(
        [],
      );
      await expect(localCommand("register-otlp", repo)).rejects.toThrow(/register-trace-mapping/);
      await localCommand("register-trace-mapping", repo);
      expect(requests.map((url) => new URL(url).pathname)).toEqual(["/v1/ingest/json-log-mapping"]);
      await writeFile(
        join(artifact, "mapping-source.json"),
        JSON.stringify({
          source_kind: "json_log",
          sample_origin: "source_derived",
          storage_rule_id: "missing-rule",
        }),
      );
      await expect(localCommand("validate-trace-mapping", repo)).rejects.toThrow(
        /confirmed JSON log rule/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires a storage rule for log mappings", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-json-log-invalid-"));
    const artifact = join(repo, ".pulse/artifacts/otlp");
    await mkdir(artifact, { recursive: true });
    await writeFile(
      join(artifact, "mapping-source.json"),
      JSON.stringify({
        source_kind: "json_log",
        sample_origin: "source_derived",
      }),
    );
    await expect(localCommand("validate-trace-mapping", repo)).rejects.toThrow(/storage_rule_id/);
  });
});
