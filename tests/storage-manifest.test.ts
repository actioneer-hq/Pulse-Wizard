import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localCommand } from "../src/commands/local.js";
import { validateDraft, validateManifest } from "../src/storage/manifest.js";

const base = {
  version: 1,
  sources: [
    {
      id: "archive",
      provider: "s3_compatible",
      bucket: "calls",
      prefix: "exports/",
      rules: [
        {
          id: "zip",
          path_regex: "^exports/([^/]+)\\.zip$",
          role: "archive",
          decoder: "opaque",
          container: "zip",
          call_id: { from: "object_path", group: 1 },
          members: [
            {
              id: "events",
              path_regex: "^events/([^/]+)\\.json$",
              role: "events",
              decoder: "json",
              records_pointer: "/records",
              call_id: { from: "json", pointer: "/call_id" },
            },
          ],
        },
      ],
    },
  ],
};

describe("storage manifest", () => {
  it("accepts ZIP members and per-record JSON call IDs", () => {
    expect(validateManifest(base).version).toBe(1);
    const draft = validateDraft({
      manifest: base,
      evidence: {
        zip: { source: "src/upload.py:10", reason: "archive upload", certainty: "proven" },
        events: { source: "src/upload.py:8", reason: "JSON records", certainty: "inferred" },
      },
    });
    expect("manifest" in draft && draft.manifest.sources[0]?.rules[0]?.members).toHaveLength(1);
  });

  it("rejects missing correlation and malformed ZIP rules", () => {
    const noId = structuredClone(base);
    // biome-ignore lint/suspicious/noExplicitAny: exercise malformed external JSON
    (noId.sources[0]!.rules[0] as any).call_id = undefined;
    expect(() => validateManifest(noId)).toThrow(/call-ID resolver/);
    const noContainer = structuredClone(base);
    // biome-ignore lint/suspicious/noExplicitAny: exercise malformed external JSON
    (noContainer.sources[0]!.rules[0] as any).container = undefined;
    expect(() => validateManifest(noContainer)).toThrow(/ZIP member list/);
    const credentials = structuredClone(base) as unknown as Record<string, unknown>;
    credentials.credentials = { secret_access_key: "no" };
    expect(() => validateManifest(credentials)).toThrow(/unsupported fields/);
    const wrongCapture = structuredClone(base);
    wrongCapture.sources[0]!.rules[0]!.call_id.group = 2;
    expect(() => validateManifest(wrongCapture)).toThrow(/capture is absent/);
  });

  it("accepts explicit stereo and dual-mono speaker layouts", () => {
    const stereo = structuredClone(base);
    const member = stereo.sources[0]!.rules[0]!.members[0]! as Record<string, unknown>;
    member.decoder = "audio";
    member.records_pointer = undefined;
    member.call_id = { from: "member_path", group: 1 };
    member.path_regex = "^audio/([^/]+)\\.wav$";
    member.audio = { layout: "stereo", channel_map: { "0": "caller", "1": "agent" } };
    expect(validateManifest(stereo).sources[0]?.rules[0]?.members?.[0]?.audio?.layout).toBe(
      "stereo",
    );

    member.audio = { layout: "dual_mono", speaker: "caller", pair_id: "recording" };
    const agent = {
      ...member,
      id: "agent",
      audio: { layout: "dual_mono", speaker: "agent", pair_id: "recording" },
    };
    (stereo.sources[0]!.rules[0]!.members as Record<string, unknown>[]).push(agent);
    expect(validateManifest(stereo).sources[0]?.rules[0]?.members?.[0]?.audio?.speaker).toBe(
      "caller",
    );
  });

  it("rejects ambiguous or conflicting audio metadata", () => {
    const manifest = structuredClone(base);
    const member = manifest.sources[0]!.rules[0]!.members[0]! as Record<string, unknown>;
    member.audio = { layout: "stereo", channel_map: { "0": "caller", "1": "agent" } };
    expect(() => validateManifest(manifest)).toThrow(/requires audio decoder/);
    member.decoder = "audio";
    member.records_pointer = undefined;
    member.call_id = { from: "member_path", group: 1 };
    member.audio = { layout: "stereo", channel_map: { "0": "caller", "1": "caller" } };
    expect(() => validateManifest(manifest)).toThrow(/identify caller and agent/);
    member.audio = { layout: "dual_mono", speaker: "agent" };
    expect(() => validateManifest(manifest)).toThrow(/pair_id is required/);
    member.audio = { layout: "dual_mono", speaker: "agent", pair_id: "recording" };
    expect(() => validateManifest(manifest)).toThrow(/needs one caller and one agent/);
  });

  it("records service and credential field names without secret values", () => {
    const manifest = structuredClone(base);
    const source = manifest.sources[0]! as Record<string, unknown>;
    source.service = "cloudflare_r2";
    source.credential_mapping = {
      "R2 Access Key ID": "access_key_id",
      "R2 Secret Access Key": "secret_access_key",
    };
    expect(validateManifest(manifest).sources[0]?.credential_mapping).toEqual(
      source.credential_mapping,
    );
    source.credential_mapping = { "R2 Secret Access Key": "account_key" };
    expect(() => validateManifest(manifest)).toThrow(/unsupported Pulse key/);
    source.credential_mapping = {
      "R2 Secret Access Key": "secret_access_key",
      "Another secret": "secret_access_key",
    };
    expect(() => validateManifest(manifest)).toThrow(/maps multiple fields/);

    source.provider = "azure";
    source.service = "azure_blob";
    source.credential_mapping = {
      "Storage account": "account_name",
      "Account key": "account_key",
    };
    expect(validateManifest(manifest).sources[0]?.credential_mapping).toEqual(
      source.credential_mapping,
    );
  });

  it("accepts semantic kinds and rejects a decoder mismatch", () => {
    const manifest = structuredClone(base);
    const member = manifest.sources[0]!.rules[0]!.members[0]! as Record<string, unknown>;
    member.kind = "log";
    expect(validateManifest(manifest).sources[0]?.rules[0]?.members?.[0]?.kind).toBe("log");
    member.kind = "otlp";
    expect(() => validateManifest(manifest)).toThrow(/requires otlp_json decoder/);
    member.kind = "made_up";
    expect(() => validateManifest(manifest)).toThrow(/kind is unsupported/);
  });

  it("validates blocked outcomes without treating them as manifests", () => {
    expect(
      validateDraft({ status: "unsupported_provider", reason: "Native GCS auth", unresolved: [] }),
    ).toMatchObject({ status: "unsupported_provider" });
    expect(validateDraft({ status: "no_storage", reason: "No blob producer" })).toMatchObject({
      status: "no_storage",
    });
    expect(() => validateDraft({ status: "unsupported_provider", reason: "" })).toThrow(/reason/);
    expect(() =>
      validateDraft({
        status: "unsupported_provider",
        reason: "Native GCS",
        inventory: "notes.md",
      }),
    ).toThrow(/unsupported fields/);
  });

  it("validates a blocked draft through the CLI without registering it", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-blocked-storage-"));
    const storage = join(repo, ".pulse/artifacts/storage");
    await mkdir(storage, { recursive: true });
    await writeFile(
      join(storage, "storage-draft.json"),
      JSON.stringify({ status: "unsupported_provider", reason: "Native GCS auth" }),
    );
    await expect(localCommand("validate-storage", repo)).resolves.toBeUndefined();
    await writeFile(
      join(storage, "storage-draft.json"),
      JSON.stringify({ status: "unsupported_provider", reason: "Native GCS auth", inventory: "x" }),
    );
    await expect(localCommand("validate-storage", repo)).rejects.toThrow(/unsupported fields/);
  });
});
