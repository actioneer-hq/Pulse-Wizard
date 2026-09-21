import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../src/storage/manifest.js";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../workbench/fixtures/storage-artifact-mix/expected.json",
);

describe("mixed storage artifact fixture", () => {
  it("covers each run object key once without assuming an audio extension", async () => {
    const { manifest: raw, keys, excluded } = JSON.parse(await readFile(fixture, "utf8"));
    const manifest = validateManifest(raw);

    for (const { key, rule: expectedRule, call_id: expectedCallId } of keys) {
      const matches = manifest.sources.flatMap((source) =>
        source.rules.flatMap((rule) => {
          if (!key.startsWith(source.prefix)) return [];
          const match = new RegExp(rule.path_regex).exec(key);
          return match ? [{ rule, match }] : [];
        }),
      );
      expect(matches.map(({ rule }) => rule.id)).toEqual([expectedRule]);
      const { rule, match } = matches[0]!;
      if (rule.call_id.from === "object_path") {
        expect(match[rule.call_id.group]).toBe(expectedCallId);
      } else {
        expect(rule.call_id).toEqual({ from: "json", pointer: "/call_id" });
      }
    }

    for (const key of excluded) {
      expect(
        manifest.sources.some(
          (source) =>
            key.startsWith(source.prefix) &&
            source.rules.some((rule) => new RegExp(rule.path_regex).test(key)),
        ),
      ).toBe(false);
    }
    const archive = manifest.sources.find((source) => source.id === "bundles")!.rules[0]!;
    expect(archive.members?.map((member) => member.id)).toEqual(["segment", "index"]);
    expect(
      new RegExp(archive.members![0]!.path_regex).test("segments/chunk-without-extension"),
    ).toBe(true);
  });
});
