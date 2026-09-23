import { WizardError } from "../util/errors.js";

export const DECODERS = [
  "otlp_json",
  "otlp_protobuf",
  "json",
  "jsonl",
  "csv",
  "text",
  "audio",
] as const;
export const CONTAINERS = ["none", "gzip", "zip", "tar"] as const;
export const TARGETS = ["call", "trace", "transcript", "audio"] as const;
export const MAPPER_TARGETS = TARGETS.filter((target) => target !== "audio");
export const STAGES = [
  "call",
  "turn",
  "speech",
  "stt",
  "llm",
  "tts",
  "playout",
  "tool",
  "net",
  "unknown",
] as const;

export type DecoderType = (typeof DECODERS)[number];
export type ContainerType = (typeof CONTAINERS)[number];
export type CanonicalTarget = (typeof TARGETS)[number];
export type MapperTarget = Exclude<CanonicalTarget, "audio">;

export interface IntegrationManifest {
  schema: "pulse.integration";
  version: 1;
  integration: {
    framework: string;
    language: string;
    use_case: string;
  };
  live_telemetry: {
    status: "ready" | "pending_exporter" | "unavailable";
    protocol: "otlp";
    mapper?: string;
    reason?: string;
  };
  connections: StorageConnection[];
  artifacts: ArtifactRule[];
  mappers: Record<string, MapperDefinition>;
  expected_capabilities: Record<string, Capability>;
}

export interface StorageConnection {
  id: string;
  driver: "s3_compatible" | "azure_blob" | "gcs" | "custom";
  service: string;
  location: Record<string, ConfigValue>;
  auth: {
    scheme: string;
    fields: Record<string, CredentialField>;
  };
  status: "ready" | "needs_configuration" | "unsupported";
  activation?: { environment_variables: string[] };
}

export type ConfigValue =
  | { from: "literal"; value: string }
  | { from: "environment"; name: string }
  | { from: "pulse"; field: string; label: string };

export interface CredentialField {
  key: string;
  secret: boolean;
  required: boolean;
}

export interface ArtifactRule {
  id: string;
  connection: string;
  selector: {
    object_path_regex: string;
    member_path_regex?: string;
  };
  container: { type: ContainerType };
  correlation: { call_id: CallIdResolver };
  decoder: { type: DecoderType; [key: string]: unknown };
  emits: ArtifactEmission[];
}

export type CallIdResolver =
  | { from: "path_capture"; scope: "object" | "member"; group: number }
  | { from: "json_pointer"; pointer: string }
  | { from: "field"; field: string }
  | { from: "mapper" };

export type ArtifactEmission =
  | { target: MapperTarget; mapper: string }
  | { target: "audio"; config: AudioConfig };

export type AudioConfig =
  | { layout: "mono"; speaker: "caller" | "agent" | "mixed"; t0_offset_s?: number }
  | {
      layout: "stereo";
      // carried when the producer proves it; omitted when unknown — Pulse detects + trust-notes
      channel_map?: Record<"0" | "1", "caller" | "agent">;
      t0_offset_s?: number;
    }
  | {
      layout: "dual_mono";
      speaker: "caller" | "agent";
      pair_id: string;
      t0_offset_s?: number;
    };

export interface MapperDefinition {
  language: "jsonata";
  input: "otlp" | "json" | "records" | "text";
  output: MapperTarget;
  cardinality: "one" | "many";
  expression: string;
}

export interface Capability {
  status: "available" | "producer_reported" | "partial" | "unavailable";
  evidence: string[];
  missing?: string[];
}

export type CanonicalFragment = CallFragment | TraceFragment | TranscriptFragment;

export interface CallFragment {
  call_id: string;
  source?: string;
  environment?: string;
  started_at?: string;
  ended_at?: string;
  engine?: string;
  carrier?: string;
  stt_provider?: string;
  llm_provider?: string;
  llm_model?: string;
  tts_provider?: string;
  voice?: string;
  template_sha256?: string;
  labels?: Record<string, unknown>;
  counters?: Record<string, unknown>;
}

export interface TraceFragment {
  call_id: string;
  header?: CallFragment;
  spans: CanonicalSpan[];
}

export interface CanonicalSpan {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  stage: (typeof STAGES)[number];
  t_start: number | null; // null = the source had no clock — never invented
  t_end: number | null;
  sequence?: number | null; // source order — the sort key when there is no clock
  turn_id: string | null;
  error?: boolean;
  attrs: Record<string, unknown>;
  content: Record<string, unknown>;
  events: CanonicalEvent[];
}

export interface CanonicalEvent {
  name: string;
  t: number | null; // null = the source had no clock
  attrs: Record<string, unknown>;
  content: Record<string, unknown>;
}

export interface TranscriptFragment {
  call_id: string;
  turns: TranscriptTurn[];
}

export interface TranscriptTurn {
  speaker: "caller" | "agent" | "system" | "tool" | "unknown";
  text: string;
  turn_id?: string;
  sequence?: number;
  t_start?: number;
  t_end?: number;
  language?: string;
}

/** Canonical span-attr names for producer-reported numbers (contract v2). Values must be
 * emitted already converted to canonical units — the conversion lives in the mapper. There
 * is no separate measurements payload: these ride the relevant span; Pulse derives the rest. */
export const SPAN_ATTR_VOCABULARY = {
  "metrics.ttft": "seconds",
  "metrics.ttfb": "seconds",
  "metrics.e2e_latency": "seconds",
  "endpointing.delay": "seconds",
  "gen_ai.usage.input_tokens": "count",
  "gen_ai.usage.output_tokens": "count",
  "gen_ai.usage.cached_tokens": "count",
  "tts.chars": "count",
  "tts.chars_cut": "count",
  "stt.confidence": "ratio",
  "turn.interrupted": "boolean",
  "turn.index": "count",
} as const;
const AUTH_SCHEMES: Record<StorageConnection["driver"], Set<string>> = {
  s3_compatible: new Set(["s3_access_key", "s3_temporary", "aws_default_chain", "gcs_hmac"]),
  azure_blob: new Set([
    "azure_account_key",
    "azure_connection_string",
    "azure_sas",
    "azure_default_credential",
  ]),
  gcs: new Set(["gcs_service_account", "gcs_adc", "gcs_hmac"]),
  custom: new Set(["custom"]),
};

const REQUIRED_AUTH_KEYS: Record<string, string[]> = {
  s3_access_key: ["access_key_id", "secret_access_key"],
  s3_temporary: ["access_key_id", "secret_access_key", "session_token"],
  gcs_hmac: ["access_key_id", "secret_access_key"],
  gcs_service_account: ["service_account_json"],
  azure_account_key: ["account_name", "account_key"],
  azure_connection_string: ["connection_string"],
  azure_sas: ["account_url", "sas_token"],
};

const SECRET_AUTH_KEYS = new Set([
  "secret_access_key",
  "session_token",
  "service_account_json",
  "account_key",
  "connection_string",
  "sas_token",
]);

const CREDENTIAL_KEYS: Record<StorageConnection["driver"], Set<string>> = {
  s3_compatible: new Set([
    "access_key_id",
    "secret_access_key",
    "session_token",
    "endpoint_url",
    "region",
  ]),
  azure_blob: new Set([
    "account_name",
    "account_key",
    "connection_string",
    "sas_token",
    "account_url",
  ]),
  gcs: new Set(["service_account_json", "project_id", "access_key_id", "secret_access_key"]),
  custom: new Set(),
};

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WizardError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, keys: string[], field: string): void {
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length) throw new WizardError(`${field} has unsupported fields: ${extra.join(", ")}`);
}

function nonempty(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || !value.trim()) throw new WizardError(`${field} is required`);
  if (value.length > max) throw new WizardError(`${field} is too long`);
  return value;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new WizardError(`${field} must be an array`);
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (!values.includes(value as T)) throw new WizardError(`${field} is unsupported`);
  return value as T;
}

function pointer(value: unknown, field: string): string {
  if (typeof value !== "string" || (value !== "" && !value.startsWith("/"))) {
    throw new WizardError(`${field} must be a JSON Pointer`);
  }
  return value;
}

function regex(value: unknown, field: string): { source: string; captures: number } {
  const source = nonempty(value, field);
  if (source.length > 512 || !source.startsWith("^") || !source.endsWith("$")) {
    throw new WizardError(`${field} must be anchored and <=512 characters`);
  }
  if (/\(\?(?!:)/.test(source) || /\\[1-9]/.test(source)) {
    throw new WizardError(`${field} uses unsupported regex features`);
  }
  try {
    new RegExp(source);
  } catch {
    throw new WizardError(`${field} is invalid`);
  }
  let captures = 0;
  let escaped = false;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "[") {
      inClass = true;
    } else if (char === "]") {
      inClass = false;
    } else if (!inClass && char === "(" && source[i + 1] !== "?") {
      captures++;
    }
  }
  return { source, captures };
}

function validateConfigValue(value: unknown, field: string): ConfigValue {
  const item = record(value, field);
  const from = enumValue(item.from, ["literal", "environment", "pulse"] as const, `${field}.from`);
  if (from === "literal") {
    onlyKeys(item, ["from", "value"], field);
    return { from, value: nonempty(item.value, `${field}.value`) };
  }
  if (from === "environment") {
    onlyKeys(item, ["from", "name"], field);
    const name = nonempty(item.name, `${field}.name`, 128);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new WizardError(`${field}.name is invalid`);
    return { from, name };
  }
  onlyKeys(item, ["from", "field", "label"], field);
  return {
    from,
    field: nonempty(item.field, `${field}.field`, 64),
    label: nonempty(item.label, `${field}.label`, 128),
  };
}

function validateConnection(value: unknown, ids: Set<string>): StorageConnection {
  const item = record(value, "connection");
  onlyKeys(
    item,
    ["id", "driver", "service", "location", "auth", "status", "activation"],
    "connection",
  );
  const id = nonempty(item.id, "connection.id", 128);
  if (ids.has(id)) throw new WizardError(`duplicate connection id: ${id}`);
  ids.add(id);
  const driver = enumValue(
    item.driver,
    ["s3_compatible", "azure_blob", "gcs", "custom"] as const,
    `${id}.driver`,
  );
  const locationRaw = record(item.location, `${id}.location`);
  const location = Object.fromEntries(
    Object.entries(locationRaw).map(([key, config]) => {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(key))
        throw new WizardError(`${id}.location key is invalid`);
      return [key, validateConfigValue(config, `${id}.location.${key}`)];
    }),
  );
  if (!Object.keys(location).length) throw new WizardError(`${id}.location must not be empty`);
  const authRaw = record(item.auth, `${id}.auth`);
  onlyKeys(authRaw, ["scheme", "fields"], `${id}.auth`);
  const scheme = nonempty(authRaw.scheme, `${id}.auth.scheme`, 64);
  if (!AUTH_SCHEMES[driver].has(scheme)) {
    throw new WizardError(`${id}.auth.scheme ${scheme} is incompatible with ${driver}`);
  }
  const fieldsRaw = record(authRaw.fields, `${id}.auth.fields`);
  const fields: Record<string, CredentialField> = {};
  const normalized = new Set<string>();
  for (const [label, raw] of Object.entries(fieldsRaw)) {
    nonempty(label, `${id}.auth field label`, 128);
    const spec = record(raw, `${id}.auth.fields.${label}`);
    onlyKeys(spec, ["key", "secret", "required"], `${id}.auth.fields.${label}`);
    const key = nonempty(spec.key, `${id}.auth.fields.${label}.key`, 64);
    if (driver !== "custom" && !CREDENTIAL_KEYS[driver].has(key)) {
      throw new WizardError(`${id}.auth field ${key} is unsupported for ${driver}`);
    }
    if (normalized.has(key)) throw new WizardError(`${id}.auth maps multiple labels to ${key}`);
    normalized.add(key);
    if (typeof spec.secret !== "boolean" || typeof spec.required !== "boolean") {
      throw new WizardError(`${id}.auth field ${key} requires boolean secret and required`);
    }
    if (SECRET_AUTH_KEYS.has(key) && !spec.secret) {
      throw new WizardError(`${id}.auth field ${key} must be secret`);
    }
    fields[label] = { key, secret: spec.secret, required: spec.required };
  }
  for (const key of REQUIRED_AUTH_KEYS[scheme] ?? []) {
    const field = Object.values(fields).find((candidate) => candidate.key === key);
    if (!field?.required) throw new WizardError(`${id}.auth requires ${key}`);
  }
  const activation =
    item.activation === undefined ? undefined : record(item.activation, `${id}.activation`);
  let parsedActivation: StorageConnection["activation"];
  if (activation) {
    onlyKeys(activation, ["environment_variables"], `${id}.activation`);
    const names = array(
      activation.environment_variables,
      `${id}.activation.environment_variables`,
    ).map((name, index) => nonempty(name, `${id}.activation.environment_variables.${index}`, 128));
    parsedActivation = { environment_variables: names };
  }
  return {
    id,
    driver,
    service: nonempty(item.service, `${id}.service`, 128),
    location,
    auth: { scheme, fields },
    status: enumValue(
      item.status,
      ["ready", "needs_configuration", "unsupported"] as const,
      `${id}.status`,
    ),
    activation: parsedActivation,
  };
}

function validateDecoder(value: unknown, id: string): ArtifactRule["decoder"] {
  const decoder = record(value, `${id}.decoder`);
  const type = enumValue(decoder.type, DECODERS, `${id}.decoder.type`);
  const allowed: Record<DecoderType, string[]> = {
    otlp_json: ["type"],
    otlp_protobuf: ["type"],
    json: ["type", "records_pointer"],
    jsonl: ["type"],
    csv: ["type", "delimiter", "header"],
    text: ["type", "encoding"],
    audio: ["type", "format"],
  };
  onlyKeys(decoder, allowed[type], `${id}.decoder`);
  if (decoder.records_pointer !== undefined)
    pointer(decoder.records_pointer, `${id}.decoder.records_pointer`);
  if (type === "text" && decoder.encoding !== undefined && decoder.encoding !== "utf-8") {
    throw new WizardError(`${id}.decoder.encoding must be utf-8`);
  }
  if (type === "csv") {
    if (
      decoder.delimiter !== undefined &&
      (typeof decoder.delimiter !== "string" || decoder.delimiter.length !== 1)
    ) {
      throw new WizardError(`${id}.decoder.delimiter must be one character`);
    }
    if (decoder.header !== undefined && typeof decoder.header !== "boolean") {
      throw new WizardError(`${id}.decoder.header must be boolean`);
    }
  }
  if (decoder.format !== undefined) nonempty(decoder.format, `${id}.decoder.format`, 32);
  return decoder as ArtifactRule["decoder"];
}

function validateAudio(value: unknown, id: string): AudioConfig {
  const audio = record(value, `${id}.audio`);
  const layout = enumValue(
    audio.layout,
    ["mono", "stereo", "dual_mono"] as const,
    `${id}.audio.layout`,
  );
  if (
    audio.t0_offset_s !== undefined &&
    (typeof audio.t0_offset_s !== "number" || !Number.isFinite(audio.t0_offset_s))
  ) {
    throw new WizardError(`${id}.audio.t0_offset_s must be a finite number`);
  }
  if (layout === "stereo") {
    onlyKeys(audio, ["layout", "channel_map", "t0_offset_s"], `${id}.audio`);
    // channel_map is evidence: carried when the producer proves it, omitted when unknown —
    // Pulse then detects speakers (noise floor) and says so in the trust report. What is
    // never allowed is a guess: include the map only with source evidence for it.
    if (audio.channel_map !== undefined) {
      const map = record(audio.channel_map, `${id}.audio.channel_map`);
      onlyKeys(map, ["0", "1"], `${id}.audio.channel_map`);
      if (!([map["0"], map["1"]].includes("caller") && [map["0"], map["1"]].includes("agent"))) {
        throw new WizardError(`${id}.audio.channel_map must identify caller and agent`);
      }
    }
    return audio as unknown as AudioConfig;
  }
  if (layout === "dual_mono") {
    onlyKeys(audio, ["layout", "speaker", "pair_id", "t0_offset_s"], `${id}.audio`);
    enumValue(audio.speaker, ["caller", "agent"] as const, `${id}.audio.speaker`);
    nonempty(audio.pair_id, `${id}.audio.pair_id`, 128);
    return audio as unknown as AudioConfig;
  }
  onlyKeys(audio, ["layout", "speaker", "t0_offset_s"], `${id}.audio`);
  enumValue(audio.speaker, ["caller", "agent", "mixed"] as const, `${id}.audio.speaker`);
  return audio as unknown as AudioConfig;
}

function validateArtifact(
  value: unknown,
  ids: Set<string>,
  connections: Set<string>,
  mappers: Record<string, MapperDefinition>,
): ArtifactRule {
  const item = record(value, "artifact");
  onlyKeys(
    item,
    ["id", "connection", "selector", "container", "correlation", "decoder", "emits"],
    "artifact",
  );
  const id = nonempty(item.id, "artifact.id", 128);
  if (ids.has(id)) throw new WizardError(`duplicate artifact id: ${id}`);
  ids.add(id);
  const connection = nonempty(item.connection, `${id}.connection`, 128);
  if (!connections.has(connection))
    throw new WizardError(`${id} references unknown connection ${connection}`);
  const selector = record(item.selector, `${id}.selector`);
  onlyKeys(selector, ["object_path_regex", "member_path_regex"], `${id}.selector`);
  const objectRegex = regex(selector.object_path_regex, `${id}.selector.object_path_regex`);
  const memberRegex =
    selector.member_path_regex === undefined
      ? undefined
      : regex(selector.member_path_regex, `${id}.selector.member_path_regex`);
  const container = record(item.container, `${id}.container`);
  onlyKeys(container, ["type"], `${id}.container`);
  const containerType = enumValue(container.type, CONTAINERS, `${id}.container.type`);
  if (["zip", "tar"].includes(containerType) !== Boolean(memberRegex)) {
    throw new WizardError(
      `${id} ZIP/TAR artifacts require member_path_regex and other containers forbid it`,
    );
  }
  const decoder = validateDecoder(item.decoder, id);
  const correlation = record(item.correlation, `${id}.correlation`);
  onlyKeys(correlation, ["call_id"], `${id}.correlation`);
  const callId = record(correlation.call_id, `${id}.correlation.call_id`);
  const from = enumValue(
    callId.from,
    ["path_capture", "json_pointer", "field", "mapper"] as const,
    `${id}.correlation.call_id.from`,
  );
  if (from === "path_capture") {
    onlyKeys(callId, ["from", "scope", "group"], `${id}.correlation.call_id`);
    const scope = enumValue(
      callId.scope,
      ["object", "member"] as const,
      `${id}.correlation.call_id.scope`,
    );
    if (!Number.isInteger(callId.group) || Number(callId.group) < 1) {
      throw new WizardError(`${id}.correlation.call_id.group must be a positive integer`);
    }
    const captures = scope === "object" ? objectRegex.captures : (memberRegex?.captures ?? 0);
    if (Number(callId.group) > captures)
      throw new WizardError(`${id} call-ID capture is absent from its regex`);
  } else if (from === "json_pointer") {
    onlyKeys(callId, ["from", "pointer"], `${id}.correlation.call_id`);
    if (!["json", "jsonl"].includes(decoder.type)) {
      throw new WizardError(`${id} JSON pointer correlation requires a JSON decoder`);
    }
    pointer(callId.pointer, `${id}.correlation.call_id.pointer`);
  } else if (from === "field") {
    onlyKeys(callId, ["from", "field"], `${id}.correlation.call_id`);
    nonempty(callId.field, `${id}.correlation.call_id.field`, 128);
  } else {
    onlyKeys(callId, ["from"], `${id}.correlation.call_id`);
  }
  const emits = array(item.emits, `${id}.emits`);
  if (!emits.length) throw new WizardError(`${id}.emits must not be empty`);
  const parsedEmits: ArtifactEmission[] = [];
  for (const [index, raw] of emits.entries()) {
    const emit = record(raw, `${id}.emits.${index}`);
    const target = enumValue(emit.target, TARGETS, `${id}.emits.${index}.target`);
    if (target === "audio") {
      onlyKeys(emit, ["target", "config"], `${id}.emits.${index}`);
      if (decoder.type !== "audio")
        throw new WizardError(`${id} audio output requires audio decoder`);
      parsedEmits.push({ target, config: validateAudio(emit.config, id) });
    } else {
      onlyKeys(emit, ["target", "mapper"], `${id}.emits.${index}`);
      const mapper = nonempty(emit.mapper, `${id}.emits.${index}.mapper`, 128);
      if (!mappers[mapper]) throw new WizardError(`${id} references unknown mapper ${mapper}`);
      if (mappers[mapper].output !== target)
        throw new WizardError(`${id} mapper ${mapper} does not emit ${target}`);
      const mapperInputByDecoder: Partial<Record<DecoderType, MapperDefinition["input"]>> = {
        otlp_json: "otlp",
        otlp_protobuf: "otlp",
        json: "json",
        jsonl: "records",
        csv: "records",
        text: "text",
      };
      if (mappers[mapper].input !== mapperInputByDecoder[decoder.type]) {
        throw new WizardError(
          `${id} decoder ${decoder.type} is incompatible with mapper input ${mappers[mapper].input}`,
        );
      }
      parsedEmits.push({ target, mapper });
    }
  }
  if (decoder.type === "audio" && parsedEmits.some((emit) => emit.target !== "audio")) {
    throw new WizardError(`${id} audio decoder may only emit audio`);
  }
  return {
    id,
    connection,
    selector: {
      object_path_regex: objectRegex.source,
      member_path_regex: memberRegex?.source,
    },
    container: { type: containerType },
    correlation: { call_id: callId as unknown as CallIdResolver },
    decoder,
    emits: parsedEmits,
  };
}

function validateMapper(value: unknown, id: string): MapperDefinition {
  const mapper = record(value, `mapper ${id}`);
  onlyKeys(mapper, ["language", "input", "output", "cardinality", "expression"], `mapper ${id}`);
  if (mapper.language !== "jsonata") throw new WizardError(`mapper ${id}.language must be jsonata`);
  const expression = nonempty(mapper.expression, `mapper ${id}.expression`, 65_536);
  if (/\$eval\s*\(/.test(expression)) throw new WizardError(`mapper ${id} may not use $eval`);
  return {
    language: "jsonata",
    input: enumValue(
      mapper.input,
      ["otlp", "json", "records", "text"] as const,
      `mapper ${id}.input`,
    ),
    output: enumValue(mapper.output, MAPPER_TARGETS, `mapper ${id}.output`),
    cardinality: enumValue(
      mapper.cardinality,
      ["one", "many"] as const,
      `mapper ${id}.cardinality`,
    ),
    expression,
  };
}

export function validateManifest(value: unknown): IntegrationManifest {
  const manifest = record(value, "manifest");
  onlyKeys(
    manifest,
    [
      "schema",
      "version",
      "integration",
      "live_telemetry",
      "connections",
      "artifacts",
      "mappers",
      "expected_capabilities",
    ],
    "manifest",
  );
  if (manifest.schema !== "pulse.integration" || manifest.version !== 1) {
    throw new WizardError("manifest requires schema pulse.integration version 1");
  }
  const integration = record(manifest.integration, "integration");
  onlyKeys(integration, ["framework", "language", "use_case"], "integration");
  const live = record(manifest.live_telemetry, "live_telemetry");
  onlyKeys(live, ["status", "protocol", "mapper", "reason"], "live_telemetry");
  const liveStatus = enumValue(
    live.status,
    ["ready", "pending_exporter", "unavailable"] as const,
    "live_telemetry.status",
  );
  if (live.protocol !== "otlp") throw new WizardError("live_telemetry.protocol must be otlp");

  const mapperRaw = record(manifest.mappers, "mappers");
  const mappers = Object.fromEntries(
    Object.entries(mapperRaw).map(([id, mapper]) => {
      nonempty(id, "mapper id", 128);
      return [id, validateMapper(mapper, id)];
    }),
  );
  if (live.mapper !== undefined) {
    const id = nonempty(live.mapper, "live_telemetry.mapper", 128);
    if (!mappers[id] || mappers[id].output !== "trace" || mappers[id].input !== "otlp") {
      throw new WizardError("live_telemetry.mapper must reference an OTLP-to-trace mapper");
    }
  }
  if (liveStatus === "ready" && live.mapper === undefined) {
    throw new WizardError("ready live telemetry requires a mapper");
  }
  if (liveStatus !== "ready" && live.mapper !== undefined) {
    throw new WizardError(`${liveStatus} live telemetry must not reference a mapper`);
  }
  if (liveStatus !== "ready" && live.reason === undefined) {
    throw new WizardError(`${liveStatus} live telemetry requires a reason`);
  }

  const connectionIds = new Set<string>();
  const connections = array(manifest.connections, "connections").map((item) =>
    validateConnection(item, connectionIds),
  );
  const artifactIds = new Set<string>();
  const artifacts = array(manifest.artifacts, "artifacts").map((item) =>
    validateArtifact(item, artifactIds, connectionIds, mappers),
  );
  const referenced = new Set<string>();
  if (typeof live.mapper === "string") referenced.add(live.mapper);
  for (const artifact of artifacts) {
    for (const emit of artifact.emits) if (emit.target !== "audio") referenced.add(emit.mapper);
  }
  for (const id of Object.keys(mappers)) {
    if (!referenced.has(id)) throw new WizardError(`mapper ${id} is not referenced`);
  }
  for (const connection of connections) {
    if (!artifacts.some((artifact) => artifact.connection === connection.id)) {
      throw new WizardError(`connection ${connection.id} has no mapped artifacts`);
    }
  }
  const pairs = new Map<string, string[]>();
  for (const artifact of artifacts) {
    for (const emit of artifact.emits) {
      if (emit.target === "audio" && emit.config.layout === "dual_mono") {
        pairs.set(emit.config.pair_id, [
          ...(pairs.get(emit.config.pair_id) ?? []),
          emit.config.speaker,
        ]);
      }
    }
  }
  for (const [pair, speakers] of pairs) {
    if (speakers.length !== 2 || !speakers.includes("caller") || !speakers.includes("agent")) {
      throw new WizardError(`dual-mono pair ${pair} needs one caller and one agent artifact`);
    }
  }

  const capabilitiesRaw = record(manifest.expected_capabilities, "expected_capabilities");
  const expected_capabilities = Object.fromEntries(
    Object.entries(capabilitiesRaw).map(([name, raw]) => {
      const capability = record(raw, `expected_capabilities.${name}`);
      onlyKeys(capability, ["status", "evidence", "missing"], `expected_capabilities.${name}`);
      const evidence = array(capability.evidence, `expected_capabilities.${name}.evidence`).map(
        (entry, index) => nonempty(entry, `expected_capabilities.${name}.evidence.${index}`),
      );
      const missing =
        capability.missing === undefined
          ? undefined
          : array(capability.missing, `expected_capabilities.${name}.missing`).map((entry, index) =>
              nonempty(entry, `expected_capabilities.${name}.missing.${index}`),
            );
      return [
        name,
        {
          status: enumValue(
            capability.status,
            ["available", "producer_reported", "partial", "unavailable"] as const,
            `expected_capabilities.${name}.status`,
          ),
          evidence,
          missing,
        },
      ];
    }),
  );
  return {
    schema: "pulse.integration",
    version: 1,
    integration: {
      framework: nonempty(integration.framework, "integration.framework", 128),
      language: nonempty(integration.language, "integration.language", 64),
      use_case: nonempty(integration.use_case, "integration.use_case", 120),
    },
    live_telemetry: {
      status: liveStatus,
      protocol: "otlp",
      mapper: live.mapper as string | undefined,
      reason:
        live.reason === undefined ? undefined : nonempty(live.reason, "live_telemetry.reason"),
    },
    connections,
    artifacts,
    mappers,
    expected_capabilities,
  };
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new WizardError(`${field} must be a nonnegative finite number`);
  }
  return value;
}

/** A relative time in canonical units. Epoch/millisecond magnitudes are unit-conversion
 * mistakes in the mapper (units doctrine: prove the source unit from code, convert in
 * JSONata) — reject them rather than store a 55-year call. */
function relativeSeconds(value: unknown, field: string): number {
  const v = finite(value, field);
  if (v >= 1e6) {
    throw new WizardError(
      `${field} is ${v} — epoch/millisecond magnitude; relative times are seconds from t0, convert in the mapper`,
    );
  }
  return v;
}

function validateCall(value: unknown): CallFragment {
  const call = record(value, "call fragment");
  const fields = [
    "call_id",
    "source",
    "environment",
    "started_at",
    "ended_at",
    "engine",
    "carrier",
    "stt_provider",
    "llm_provider",
    "llm_model",
    "tts_provider",
    "voice",
    "template_sha256",
    "labels",
    "counters",
  ];
  onlyKeys(call, fields, "call fragment");
  nonempty(call.call_id, "call.call_id", 256);
  for (const field of fields.slice(1, 12)) {
    if (call[field] !== undefined) nonempty(call[field], `call.${field}`, 512);
  }
  for (const field of ["started_at", "ended_at"]) {
    if (call[field] !== undefined && Number.isNaN(Date.parse(String(call[field])))) {
      throw new WizardError(`call.${field} must be ISO-8601`);
    }
  }
  if (call.labels !== undefined) record(call.labels, "call.labels");
  if (call.counters !== undefined) record(call.counters, "call.counters");
  return call as unknown as CallFragment;
}

function validateTrace(value: unknown): TraceFragment {
  const trace = record(value, "trace fragment");
  onlyKeys(trace, ["call_id", "header", "spans"], "trace fragment");
  const callId = nonempty(trace.call_id, "trace.call_id", 256);
  if (trace.header !== undefined) {
    const header = validateCall(trace.header);
    if (header.call_id !== callId)
      throw new WizardError("trace.header.call_id must match trace.call_id");
  }
  const spans = array(trace.spans, "trace.spans");
  if (!spans.length) throw new WizardError("trace.spans must not be empty");
  const ids = new Set<string>();
  for (const [index, raw] of spans.entries()) {
    const span = record(raw, `trace.spans.${index}`);
    onlyKeys(
      span,
      [
        "span_id",
        "parent_span_id",
        "name",
        "stage",
        "t_start",
        "t_end",
        "sequence",
        "turn_id",
        "error",
        "attrs",
        "content",
        "events",
      ],
      `trace.spans.${index}`,
    );
    const id = nonempty(span.span_id, `trace.spans.${index}.span_id`, 256);
    if (ids.has(id)) throw new WizardError(`duplicate span id: ${id}`);
    ids.add(id);
    nonempty(span.name, `trace.spans.${index}.name`, 256);
    const stage = enumValue(span.stage, STAGES, `trace.spans.${index}.stage`);
    // Evidence is nullable: null/absent time = the source had no clock. Nothing invented.
    const untimed = span.t_start === null || span.t_start === undefined;
    let start: number | null = null;
    if (!untimed) {
      start = relativeSeconds(span.t_start, `trace.spans.${index}.t_start`);
    }
    if (span.t_end !== null && span.t_end !== undefined) {
      const end = relativeSeconds(span.t_end, `trace.spans.${index}.t_end`);
      if (start === null)
        throw new WizardError(`${id}.t_end without t_start — a close needs an open`);
      if (end < start) throw new WizardError(`${id}.t_end precedes t_start`);
    }
    if (span.sequence !== null && span.sequence !== undefined) {
      if (!Number.isInteger(span.sequence) || Number(span.sequence) < 0)
        throw new WizardError(`${id}.sequence must be a nonnegative integer`);
    } else if (untimed) {
      // Ordering is the universal concept; time is merely its best source. No clock -> the
      // source order is the only order, so it must be carried.
      throw new WizardError(`${id} has no t_start — untimed spans must carry sequence`);
    }
    if (span.parent_span_id !== null && span.parent_span_id !== undefined) {
      nonempty(span.parent_span_id, `${id}.parent_span_id`, 256);
    }
    if (span.turn_id !== null && span.turn_id !== undefined) {
      nonempty(span.turn_id, `${id}.turn_id`, 256);
    }
    if (span.error !== undefined && typeof span.error !== "boolean")
      throw new WizardError(`${id}.error must be boolean`);
    const attrs = record(span.attrs, `${id}.attrs`);
    const content = record(span.content, `${id}.content`);
    const events = array(span.events, `${id}.events`);
    // The floor rule: a span must assert at least one fact.
    if (
      untimed &&
      stage === "unknown" &&
      !Object.keys(attrs).length &&
      !Object.keys(content).length &&
      !events.length
    ) {
      throw new WizardError(`${id} asserts no fact — emit nothing instead of null husks`);
    }
    for (const [eventIndex, eventRaw] of events.entries()) {
      const event = record(eventRaw, `${id}.events.${eventIndex}`);
      onlyKeys(event, ["name", "t", "attrs", "content"], `${id}.events.${eventIndex}`);
      nonempty(event.name, `${id}.events.${eventIndex}.name`, 256);
      if (event.t !== null && event.t !== undefined) {
        const et = relativeSeconds(event.t, `${id}.events.${eventIndex}.t`);
        // an event belongs to its span's window when the span is timed (small tolerance)
        if (start !== null && et < start - 1) {
          throw new WizardError(`${id}.events.${eventIndex}.t precedes its span`);
        }
      }
      record(event.attrs, `${id}.events.${eventIndex}.attrs`);
      record(event.content, `${id}.events.${eventIndex}.content`);
    }
  }
  return trace as unknown as TraceFragment;
}

function validateTranscript(value: unknown): TranscriptFragment {
  const transcript = record(value, "transcript fragment");
  onlyKeys(transcript, ["call_id", "turns"], "transcript fragment");
  nonempty(transcript.call_id, "transcript.call_id", 256);
  const turns = array(transcript.turns, "transcript.turns");
  if (!turns.length) throw new WizardError("transcript.turns must not be empty");
  for (const [index, raw] of turns.entries()) {
    const turn = record(raw, `transcript.turns.${index}`);
    onlyKeys(
      turn,
      ["speaker", "text", "turn_id", "sequence", "t_start", "t_end", "language"],
      `transcript.turns.${index}`,
    );
    enumValue(
      turn.speaker,
      ["caller", "agent", "system", "tool", "unknown"] as const,
      `transcript.turns.${index}.speaker`,
    );
    nonempty(turn.text, `transcript.turns.${index}.text`, 100_000);
    if (turn.turn_id !== undefined)
      nonempty(turn.turn_id, `transcript.turns.${index}.turn_id`, 256);
    if (
      turn.sequence !== undefined &&
      (!Number.isInteger(turn.sequence) || Number(turn.sequence) < 0)
    ) {
      throw new WizardError(`transcript.turns.${index}.sequence must be a nonnegative integer`);
    }
    if (turn.t_start === undefined && turn.sequence === undefined) {
      // no clock and no source order -> the line has no place in the conversation
      throw new WizardError(
        `transcript.turns.${index} has neither t_start nor sequence — untimed turns must carry sequence`,
      );
    }
    if (turn.t_start !== undefined)
      relativeSeconds(turn.t_start, `transcript.turns.${index}.t_start`);
    if (turn.t_end !== undefined) relativeSeconds(turn.t_end, `transcript.turns.${index}.t_end`);
    if (
      turn.t_start !== undefined &&
      turn.t_end !== undefined &&
      Number(turn.t_end) < Number(turn.t_start)
    ) {
      throw new WizardError(`transcript.turns.${index}.t_end precedes t_start`);
    }
    if (turn.language !== undefined)
      nonempty(turn.language, `transcript.turns.${index}.language`, 32);
  }
  return transcript as unknown as TranscriptFragment;
}

export function validateCanonicalFragment(value: unknown, target: MapperTarget): CanonicalFragment {
  if (target === "call") return validateCall(value);
  if (target === "trace") return validateTrace(value);
  return validateTranscript(value);
}
