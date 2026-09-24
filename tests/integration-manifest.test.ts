import { describe, expect, it } from "vitest";
import { validateCanonicalFragment, validateManifest } from "../src/integration/manifest.js";
import { manifest } from "./helpers.js";

describe("integration manifest", () => {
  it("accepts native GCS credentials, extensionless evidence, text, and explicit audio channels", () => {
    const parsed = validateManifest(manifest());
    expect(parsed.connections[0]?.driver).toBe("gcs");
    expect(parsed.artifacts.find(({ id }) => id === "conversation")?.decoder.type).toBe("text");
    expect(parsed.artifacts.find(({ id }) => id === "recording")?.emits[0]).toMatchObject({
      target: "audio",
      config: { layout: "stereo", channel_map: { "0": "agent", "1": "caller" } },
    });
  });

  it("accepts and preserves the ingest_method", () => {
    expect(validateManifest(manifest()).ingest_method).toBe("storage_polling");
  });

  it("rejects an unknown ingest_method", () => {
    const value = manifest() as unknown as Record<string, unknown>;
    value.ingest_method = "carrier_pigeon";
    expect(() => validateManifest(value)).toThrow(/ingest_method is unsupported/);
  });

  it("rejects storage_polling with no artifacts", () => {
    const value = manifest();
    value.artifacts = [];
    value.connections = [];
    value.mappers = {};
    expect(() => validateManifest(value)).toThrow(/storage_polling requires at least one/);
  });

  it("rejects telemetry_ingest_event that maps stored artifacts", () => {
    const value = manifest();
    value.ingest_method = "telemetry_ingest_event";
    expect(() => validateManifest(value)).toThrow(/telemetry_ingest_event/);
  });

  it("rejects the discarded kind-based format", () => {
    const value = manifest() as unknown as Record<string, unknown>;
    const artifacts = value.artifacts as Array<Record<string, unknown>>;
    artifacts[0]!.kind = "transcript";
    expect(() => validateManifest(value)).toThrow(/unsupported fields: kind/);
  });

  it("requires complete dual-mono speaker pairs", () => {
    const value = manifest();
    value.artifacts[2]!.emits = [
      { target: "audio", config: { layout: "dual_mono", speaker: "caller", pair_id: "call" } },
    ];
    expect(() => validateManifest(value)).toThrow(/one caller and one agent/);
  });

  it("rejects decoder and mapper input mismatches", () => {
    const value = manifest();
    value.mappers["conversation-transcript"]!.input = "json";
    expect(() => validateManifest(value)).toThrow(/decoder text is incompatible/);
  });

  it("rejects provider-incompatible authentication schemes", () => {
    const value = manifest();
    value.connections[0]!.auth.scheme = "azure_sas";
    expect(() => validateManifest(value)).toThrow(/incompatible with gcs/);
  });

  it("represents archive members without treating source paths as object keys", () => {
    const value = manifest();
    value.artifacts[0]!.selector = {
      object_path_regex: "^exports/([^/]+)/bundle$",
      member_path_regex: "^conversation$",
    };
    value.artifacts[0]!.container = { type: "zip" };
    const parsed = validateManifest(value);
    expect(parsed.artifacts[0]?.selector.member_path_regex).toBe("^conversation$");
  });
});

describe("canonical fragments (contract v2 — evidence is nullable)", () => {
  const span = (over: Record<string, unknown> = {}) => ({
    span_id: "s-1",
    parent_span_id: null,
    name: "line",
    stage: "stt",
    t_start: null,
    t_end: null,
    sequence: 0,
    turn_id: "t-1",
    attrs: {},
    content: { transcript: "hello" },
    events: [],
    ...over,
  });
  const trace = (over: Record<string, unknown> = {}) =>
    ({ call_id: "c-1", spans: [span(over)] }) as unknown;

  it("accepts an untimed span that carries sequence and content", () => {
    expect(() => validateCanonicalFragment(trace(), "trace")).not.toThrow();
  });

  it("rejects an untimed span without sequence — source order is the only order", () => {
    expect(() => validateCanonicalFragment(trace({ sequence: null }), "trace")).toThrow(
      /untimed spans must carry sequence/,
    );
  });

  it("rejects epoch/millisecond magnitudes — unit conversion belongs in the mapper", () => {
    expect(() =>
      validateCanonicalFragment(trace({ t_start: 1758600000, t_end: 1758600004 }), "trace"),
    ).toThrow(/epoch\/millisecond magnitude/);
  });

  it("rejects a null husk that asserts no fact", () => {
    expect(() =>
      validateCanonicalFragment(trace({ stage: "unknown", content: {}, sequence: 1 }), "trace"),
    ).toThrow(/asserts no fact/);
  });

  it("rejects a close without an open", () => {
    expect(() => validateCanonicalFragment(trace({ t_end: 2.5 }), "trace")).toThrow(
      /t_end without t_start/,
    );
  });

  it("accepts sequence-only transcript turns and rejects orderless ones", () => {
    const turns = (turn: Record<string, unknown>) => ({ call_id: "c-1", turns: [turn] }) as unknown;
    expect(() =>
      validateCanonicalFragment(
        turns({ speaker: "caller", text: "hi", sequence: 0 }),
        "transcript",
      ),
    ).not.toThrow();
    expect(() =>
      validateCanonicalFragment(turns({ speaker: "caller", text: "hi" }), "transcript"),
    ).toThrow(/neither t_start nor sequence/);
  });

  it("accepts stereo audio without a channel_map — Pulse detects and trust-notes", () => {
    const value = manifest();
    value.artifacts[2]!.emits = [{ target: "audio", config: { layout: "stereo" } }];
    expect(() => validateManifest(value)).not.toThrow();
  });
});
