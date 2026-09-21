import { WizardError } from "../util/errors.js";

export type CallId =
  | { from: "object_path" | "member_path"; group: number }
  | { from: "json"; pointer: string };

export interface ArtifactRule {
  id: string;
  path_regex: string;
  role: string;
  kind?: "otlp" | "log" | "metadata" | "audio" | "transcript" | "other";
  decoder: "audio" | "otlp_json" | "json" | "opaque";
  audio?: {
    layout: "mono" | "stereo" | "dual_mono";
    speaker?: "caller" | "agent" | "mixed";
    channel_map?: Record<"0" | "1", "caller" | "agent">;
    pair_id?: string;
  };
  container?: "zip";
  call_id: CallId;
  records_pointer?: string;
  members?: ArtifactRule[];
}

export interface StorageManifest {
  version: 1;
  sources: {
    id: string;
    provider: "s3_compatible" | "azure";
    service?: string;
    bucket: string;
    prefix: string;
    endpoint?: string;
    region?: string;
    credential_mapping?: Record<string, string>;
    rules: ArtifactRule[];
  }[];
}

export interface StorageDraft {
  manifest: StorageManifest;
  evidence: Record<string, { source: string; reason: string; certainty: "proven" | "inferred" }>;
  unresolved?: string[];
}

export interface BlockedStorageDraft {
  status: "no_storage" | "unsupported_provider";
  reason: string;
  unresolved?: string[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WizardError("storage manifest must contain JSON objects");
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new WizardError(`${field} is required`);
  return value;
}

function onlyKeys(value: Record<string, unknown>, keys: string[], field: string): void {
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length) throw new WizardError(`${field} has unsupported fields: ${extra.join(", ")}`);
}

function captureCount(pattern: string): number {
  let count = 0;
  let escaped = false;
  let classDepth = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[") {
      classDepth = true;
      continue;
    }
    if (char === "]") {
      classDepth = false;
      continue;
    }
    if (!classDepth && char === "(" && pattern[i + 1] !== "?") count++;
  }
  return count;
}

function pointer(value: unknown, field: string): void {
  if (typeof value !== "string" || (value !== "" && !value.startsWith("/"))) {
    throw new WizardError(`${field} must be a JSON Pointer`);
  }
}

function checkRule(
  value: unknown,
  ids: Set<string>,
  member: boolean,
  objectCaptures = 0,
): ArtifactRule {
  const rule = record(value);
  onlyKeys(
    rule,
    [
      "id",
      "path_regex",
      "role",
      "kind",
      "decoder",
      "audio",
      "container",
      "call_id",
      "records_pointer",
      "members",
    ],
    "rule",
  );
  const id = nonempty(rule.id, "rule.id");
  if (ids.has(id)) throw new WizardError(`duplicate rule id: ${id}`);
  ids.add(id);
  const pattern = nonempty(rule.path_regex, `${id}.path_regex`);
  if (pattern.length > 512 || !pattern.startsWith("^") || !pattern.endsWith("$")) {
    throw new WizardError(`${id}.path_regex must be anchored and <=512 characters`);
  }
  if (/\(\?(?!:)/.test(pattern) || /\\[1-9]/.test(pattern)) {
    throw new WizardError(`${id}.path_regex uses unsupported regex features`);
  }
  try {
    new RegExp(pattern);
  } catch {
    throw new WizardError(`${id}.path_regex is invalid`);
  }
  nonempty(rule.role, `${id}.role`);
  if (rule.kind !== undefined) {
    if (!["otlp", "log", "metadata", "audio", "transcript", "other"].includes(String(rule.kind))) {
      throw new WizardError(`${id}.kind is unsupported`);
    }
    const requiredDecoder = { otlp: "otlp_json", log: "json", audio: "audio" }[String(rule.kind)];
    if (requiredDecoder && rule.decoder !== requiredDecoder) {
      throw new WizardError(`${id}.kind requires ${requiredDecoder} decoder`);
    }
  }
  if (!["audio", "otlp_json", "json", "opaque"].includes(String(rule.decoder))) {
    throw new WizardError(`${id}.decoder is unsupported`);
  }
  if (rule.audio !== undefined) {
    if (rule.decoder !== "audio") throw new WizardError(`${id}.audio requires audio decoder`);
    const audio = record(rule.audio);
    onlyKeys(audio, ["layout", "speaker", "channel_map", "pair_id"], `${id}.audio`);
    if (!["mono", "stereo", "dual_mono"].includes(String(audio.layout))) {
      throw new WizardError(`${id}.audio.layout is unsupported`);
    }
    if (audio.layout === "stereo") {
      if (audio.speaker !== undefined || audio.pair_id !== undefined) {
        throw new WizardError(`${id}.audio stereo uses channel_map, not speaker or pair_id`);
      }
      const map = record(audio.channel_map);
      onlyKeys(map, ["0", "1"], `${id}.audio.channel_map`);
      if (!([map["0"], map["1"]].includes("caller") && [map["0"], map["1"]].includes("agent"))) {
        throw new WizardError(`${id}.audio.channel_map must identify caller and agent`);
      }
    } else {
      if (audio.channel_map !== undefined)
        throw new WizardError(`${id}.audio mono cannot have channel_map`);
      if (!["caller", "agent", "mixed"].includes(String(audio.speaker))) {
        throw new WizardError(`${id}.audio.speaker is required`);
      }
      if (audio.layout === "dual_mono") {
        nonempty(audio.pair_id, `${id}.audio.pair_id`);
        if (audio.speaker === "mixed") {
          throw new WizardError(`${id}.audio dual_mono needs one speaker per track`);
        }
      } else if (audio.pair_id !== undefined)
        throw new WizardError(`${id}.audio mono cannot have pair_id`);
    }
  }
  if (!rule.call_id) throw new WizardError(`${id}: missing call-ID resolver`);
  const callId = record(rule.call_id);
  onlyKeys(callId, ["from", "group", "pointer"], `${id}.call_id`);
  if (callId.from === "json") {
    if (rule.decoder !== "json" && rule.decoder !== "otlp_json") {
      throw new WizardError(`${id}: JSON call ID requires a JSON decoder`);
    }
    pointer(callId.pointer, `${id}.call_id.pointer`);
  } else if (callId.from === "object_path" || callId.from === "member_path") {
    if (callId.from === "member_path" && !member) {
      throw new WizardError(`${id}: member_path is only valid inside ZIPs`);
    }
    if (!Number.isInteger(callId.group) || (callId.group as number) < 1) {
      throw new WizardError(`${id}.call_id.group must be a positive capture index`);
    }
    if (callId.from === "member_path" && (callId.group as number) > captureCount(pattern)) {
      throw new WizardError(`${id}: member call-ID capture is absent from regex`);
    }
    if (
      callId.from === "object_path" &&
      (callId.group as number) > (member ? objectCaptures : captureCount(pattern))
    ) {
      throw new WizardError(`${id}: object call-ID capture is absent from regex`);
    }
  } else {
    throw new WizardError(`${id}: missing call-ID resolver`);
  }
  if (rule.records_pointer !== undefined) pointer(rule.records_pointer, `${id}.records_pointer`);
  if (rule.records_pointer !== undefined && !["json", "otlp_json"].includes(String(rule.decoder))) {
    throw new WizardError(`${id}: record selection requires JSON`);
  }
  if (rule.members !== undefined) {
    if (
      member ||
      rule.container !== "zip" ||
      rule.decoder !== "opaque" ||
      !Array.isArray(rule.members) ||
      rule.members.length === 0
    ) {
      throw new WizardError(`${id}.members must be a nonempty ZIP member list`);
    }
    for (const child of rule.members) checkRule(child, ids, true, captureCount(pattern));
  } else if (rule.container !== undefined) {
    throw new WizardError(`${id}: ZIP container requires members`);
  }
  return rule as unknown as ArtifactRule;
}

export function validateManifest(value: unknown): StorageManifest {
  const manifest = record(value);
  if (manifest.version !== 1) throw new WizardError("storage manifest version must be 1");
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new WizardError("storage manifest needs at least one source");
  }
  const ids = new Set<string>();
  for (const value of manifest.sources) {
    const source = record(value);
    onlyKeys(
      source,
      [
        "id",
        "provider",
        "service",
        "bucket",
        "prefix",
        "endpoint",
        "region",
        "credential_mapping",
        "rules",
      ],
      "source",
    );
    const id = nonempty(source.id, "source.id");
    if (ids.has(id)) throw new WizardError(`duplicate source id: ${id}`);
    ids.add(id);
    if (!["s3_compatible", "azure"].includes(String(source.provider))) {
      throw new WizardError(`${id}.provider is unsupported`);
    }
    if (source.service !== undefined) nonempty(source.service, `${id}.service`);
    if (source.credential_mapping !== undefined) {
      const mapping = record(source.credential_mapping);
      if (!Object.keys(mapping).length)
        throw new WizardError(`${id}.credential_mapping must not be empty`);
      const supported =
        source.provider === "s3_compatible"
          ? ["access_key_id", "secret_access_key", "endpoint_url", "region"]
          : ["account_name", "account_key", "connection_string", "sas_token", "account_url"];
      const mapped = new Set<string>();
      for (const [producerField, pulseField] of Object.entries(mapping)) {
        if (!/^[A-Za-z][A-Za-z0-9_. -]{0,63}$/.test(producerField)) {
          throw new WizardError(`${id}.credential_mapping has an invalid field name`);
        }
        if (!supported.includes(String(pulseField))) {
          throw new WizardError(`${id}.credential_mapping has an unsupported Pulse key`);
        }
        if (mapped.has(String(pulseField))) {
          throw new WizardError(`${id}.credential_mapping maps multiple fields to ${pulseField}`);
        }
        mapped.add(String(pulseField));
      }
    }
    nonempty(source.bucket, `${id}.bucket`);
    if (typeof source.prefix !== "string") throw new WizardError(`${id}.prefix is required`);
    if (!Array.isArray(source.rules) || source.rules.length === 0) {
      throw new WizardError(`${id}.rules must not be empty`);
    }
    for (const rule of source.rules) checkRule(rule, ids, false);
    const pairs = new Map<string, string[]>();
    const collect = (rules: ArtifactRule[]): void => {
      for (const rule of rules) {
        if (rule.audio?.layout === "dual_mono") {
          const pairId = rule.audio.pair_id!;
          pairs.set(pairId, [...(pairs.get(pairId) ?? []), rule.audio.speaker!]);
        }
        if (rule.members) collect(rule.members);
      }
    };
    collect(source.rules as ArtifactRule[]);
    for (const [pairId, speakers] of pairs) {
      if (speakers.length !== 2 || !speakers.includes("caller") || !speakers.includes("agent")) {
        throw new WizardError(`${id}.audio pair ${pairId} needs one caller and one agent track`);
      }
    }
  }
  onlyKeys(manifest, ["version", "sources"], "manifest");
  return manifest as unknown as StorageManifest;
}

export function validateDraft(value: unknown): StorageDraft | BlockedStorageDraft {
  const draft = record(value);
  if ("status" in draft) {
    onlyKeys(draft, ["status", "reason", "unresolved"], "blocked draft");
    if (draft.status !== "no_storage" && draft.status !== "unsupported_provider") {
      throw new WizardError("blocked draft status is unsupported");
    }
    nonempty(draft.reason, "blocked draft.reason");
    if (
      draft.unresolved !== undefined &&
      (!Array.isArray(draft.unresolved) ||
        draft.unresolved.some((item: unknown) => typeof item !== "string" || !item.trim()))
    ) {
      throw new WizardError("blocked draft.unresolved must be nonempty strings");
    }
    return draft as unknown as BlockedStorageDraft;
  }
  const manifest = validateManifest(draft.manifest);
  const evidence = record(draft.evidence);
  for (const source of manifest.sources) {
    for (const rule of source.rules) {
      for (const item of [rule, ...(rule.members ?? [])]) {
        const entry = record(evidence[item.id]);
        nonempty(entry.source, `${item.id}.evidence.source`);
        nonempty(entry.reason, `${item.id}.evidence.reason`);
        if (entry.certainty !== "proven" && entry.certainty !== "inferred") {
          throw new WizardError(`${item.id}.evidence.certainty is required`);
        }
      }
    }
  }
  if (draft.unresolved !== undefined && !Array.isArray(draft.unresolved)) {
    throw new WizardError("draft.unresolved must be a list");
  }
  return draft as unknown as StorageDraft;
}
