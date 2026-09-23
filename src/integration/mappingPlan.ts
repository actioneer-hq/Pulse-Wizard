import { WizardError } from "../util/errors.js";
import { CANONICAL_CONTRACT } from "./contract.js";
import type { DecoderType, IntegrationManifest } from "./manifest.js";

export const MAPPING_PLAN_SCHEMA = "pulse.mapping-plan" as const;
export const REQUIREMENT_STATUSES = [
  "mapped",
  "runtime_derived",
  "unavailable",
  "inactive",
  "unsupported",
] as const;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export interface MappingPlan {
  schema: typeof MAPPING_PLAN_SCHEMA;
  version: 1;
  requirements: Record<string, RequirementDecision>;
  sources: SourceFormat[];
  overlaps: OverlapDecision[];
}

export interface RequirementDecision {
  status: RequirementStatus;
  sources?: string[];
  reason?: string;
}

export interface SourceFormat {
  id: string;
  producer: {
    file: string;
    symbol: string;
  };
  artifact_ids: string[];
  mapper_ids: string[];
  format: {
    decoder: DecoderType;
    cardinality: "one" | "many";
    description: string;
    variants: Array<{
      id: string;
      description: string;
      cases: string[];
    }>;
    projections: SourceProjection[];
  };
  path_cases: PathCase[];
}

export interface SourceProjection {
  id: string;
  locator: string;
  canonical_fields: string[];
  via: { mapper: string } | { artifact: string } | { unmapped: true };
  use: "selected" | "duplicate_not_selected";
  /** Units doctrine: required whenever canonical_fields includes a time field. The agent
   * proves the source unit from the code that WRITES the number (the API used), cites it,
   * and encodes the conversion in the mapper. Magnitude eyeballing is never proof. */
  unit_evidence?: UnitEvidence;
}

export interface UnitEvidence {
  source_api: string; // e.g. "Date.now()", "time.time()", "startTimeUnixNano"
  file: string; // producer file where the number is written
  line?: number;
  source_unit: "s" | "ms" | "ns" | "epoch_s" | "epoch_ms" | "iso";
}

const TIME_FIELDS = new Set([
  "Span.t_start",
  "Span.t_end",
  "SpanEvent.t",
  "TranscriptTurn.t_start",
  "TranscriptTurn.t_end",
  "CallHeader.started_at",
  "CallHeader.ended_at",
  "AudioRef.t0_offset_s",
]);

export interface PathCase {
  artifact_id: string;
  object_path: string;
  member_path?: string | null;
  matches: boolean;
  call_id?: string;
}

export interface OverlapDecision {
  canonical_fields: string[];
  candidates: string[];
  selected: string;
  confirmed: true;
}

export interface MappingCase {
  schema: "pulse.mapping-case";
  version: 1;
  source: string;
  variant: string;
  input: unknown;
  expected: Record<string, unknown>;
}

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

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new WizardError(`${field} must be an array`);
  const result = value.map((item, index) => nonempty(item, `${field}.${index}`, 256));
  if (new Set(result).size !== result.length) throw new WizardError(`${field} has duplicates`);
  return result;
}

function enumValue<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  if (!choices.includes(value as T)) throw new WizardError(`${field} is unsupported`);
  return value as T;
}

export function canonicalFieldIds(): string[] {
  const skipped = new Set(["CallEvidence"]);
  return Object.entries(CANONICAL_CONTRACT.models).flatMap(([model, definition]) =>
    skipped.has(model) ? [] : Object.keys(definition.fields).map((field) => `${model}.${field}`),
  );
}

function isCorrelationField(field: string): boolean {
  return field.endsWith(".call_id");
}

function validateProjection(value: unknown, sourceId: string, ids: Set<string>): SourceProjection {
  const item = record(value, `${sourceId}.projection`);
  onlyKeys(
    item,
    ["id", "locator", "canonical_fields", "via", "use", "unit_evidence"],
    `${sourceId}.projection`,
  );
  const id = nonempty(item.id, `${sourceId}.projection.id`, 128);
  if (ids.has(id)) throw new WizardError(`${sourceId} has duplicate projection ${id}`);
  ids.add(id);
  const canonical_fields = stringArray(
    item.canonical_fields,
    `${sourceId}.projection.${id}.canonical_fields`,
  );
  if (!canonical_fields.length) throw new WizardError(`${sourceId}.${id} maps no canonical fields`);
  const known = new Set(canonicalFieldIds());
  for (const field of canonical_fields) {
    if (!known.has(field))
      throw new WizardError(`${sourceId}.${id} uses unknown canonical field ${field}`);
  }
  const via = record(item.via, `${sourceId}.projection.${id}.via`);
  const keys = Object.keys(via);
  if (keys.length !== 1 || !["mapper", "artifact", "unmapped"].includes(keys[0]!)) {
    throw new WizardError(
      `${sourceId}.${id}.via requires exactly one mapper, artifact, or unmapped`,
    );
  }
  if (keys[0] === "unmapped" && via.unmapped !== true) {
    throw new WizardError(`${sourceId}.${id}.via.unmapped must be true`);
  }
  const carriesTime = canonical_fields.some((field) => TIME_FIELDS.has(field));
  let unit_evidence: UnitEvidence | undefined;
  if (item.unit_evidence !== undefined) {
    const ev = record(item.unit_evidence, `${sourceId}.${id}.unit_evidence`);
    onlyKeys(ev, ["source_api", "file", "line", "source_unit"], `${sourceId}.${id}.unit_evidence`);
    unit_evidence = {
      source_api: nonempty(ev.source_api, `${sourceId}.${id}.unit_evidence.source_api`, 256),
      file: nonempty(ev.file, `${sourceId}.${id}.unit_evidence.file`, 512),
      source_unit: enumValue(
        ev.source_unit,
        ["s", "ms", "ns", "epoch_s", "epoch_ms", "iso"] as const,
        `${sourceId}.${id}.unit_evidence.source_unit`,
      ),
    };
    if (ev.line !== undefined) {
      if (!Number.isInteger(ev.line) || Number(ev.line) < 1)
        throw new WizardError(`${sourceId}.${id}.unit_evidence.line must be a positive integer`);
      unit_evidence.line = Number(ev.line);
    }
  } else if (carriesTime && keys[0] === "mapper") {
    // Units doctrine: a time field's unit must be PROVEN from the code that writes it,
    // never guessed from magnitude. No proof recorded -> the mapping is not trustworthy.
    throw new WizardError(
      `${sourceId}.${id} maps time fields but has no unit_evidence — cite the producer code that writes the number and its unit`,
    );
  }
  return {
    id,
    locator: nonempty(item.locator, `${sourceId}.projection.${id}.locator`, 1024),
    canonical_fields,
    via:
      keys[0] === "mapper"
        ? { mapper: nonempty(via.mapper, `${sourceId}.${id}.via.mapper`, 128) }
        : keys[0] === "artifact"
          ? { artifact: nonempty(via.artifact, `${sourceId}.${id}.via.artifact`, 128) }
          : { unmapped: true },
    use: enumValue(
      item.use,
      ["selected", "duplicate_not_selected"] as const,
      `${sourceId}.${id}.use`,
    ),
    ...(unit_evidence ? { unit_evidence } : {}),
  };
}

function validateSource(value: unknown, ids: Set<string>): SourceFormat {
  const item = record(value, "source");
  onlyKeys(
    item,
    ["id", "producer", "artifact_ids", "mapper_ids", "format", "path_cases"],
    "source",
  );
  const id = nonempty(item.id, "source.id", 128);
  if (ids.has(id)) throw new WizardError(`duplicate source id: ${id}`);
  ids.add(id);
  const producer = record(item.producer, `${id}.producer`);
  onlyKeys(producer, ["file", "symbol"], `${id}.producer`);
  const file = nonempty(producer.file, `${id}.producer.file`, 512);
  if (file.startsWith("/") || file.split("/").includes(".pulse") || file.includes("..")) {
    throw new WizardError(`${id}.producer.file must be a repository-relative application path`);
  }
  const symbol = nonempty(producer.symbol, `${id}.producer.symbol`, 256);
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(symbol)) {
    throw new WizardError(`${id}.producer.symbol must be a code identifier`);
  }
  const artifact_ids = stringArray(item.artifact_ids, `${id}.artifact_ids`);
  const mapper_ids = stringArray(item.mapper_ids, `${id}.mapper_ids`);
  const format = record(item.format, `${id}.format`);
  onlyKeys(
    format,
    ["decoder", "cardinality", "description", "variants", "projections"],
    `${id}.format`,
  );
  const variantIds = new Set<string>();
  const caseIds = new Set<string>();
  if (!Array.isArray(format.variants))
    throw new WizardError(`${id}.format.variants must be an array`);
  const variants = format.variants.map((raw, index) => {
    const variant = record(raw, `${id}.format.variants.${index}`);
    onlyKeys(variant, ["id", "description", "cases"], `${id}.format.variants.${index}`);
    const variantId = nonempty(variant.id, `${id}.format.variants.${index}.id`, 128);
    if (variantIds.has(variantId))
      throw new WizardError(`${id} has duplicate variant ${variantId}`);
    variantIds.add(variantId);
    const cases = stringArray(variant.cases, `${id}.${variantId}.cases`);
    if (!cases.length) throw new WizardError(`${id}.${variantId} must declare at least one case`);
    for (const caseId of cases) {
      if (caseIds.has(caseId)) throw new WizardError(`${id} has duplicate case ${caseId}`);
      caseIds.add(caseId);
    }
    return {
      id: variantId,
      description: nonempty(variant.description, `${id}.${variantId}.description`, 1024),
      cases,
    };
  });
  const projectionIds = new Set<string>();
  if (!Array.isArray(format.projections) || !format.projections.length) {
    throw new WizardError(`${id}.format.projections must not be empty`);
  }
  const projections = format.projections.map((projection) =>
    validateProjection(projection, id, projectionIds),
  );
  const selected = projections.filter(({ use }) => use === "selected");
  if (selected.length && !artifact_ids.length && !mapper_ids.length) {
    throw new WizardError(`${id} has selected projections without an artifact or mapper`);
  }
  if (selected.length && !variants.length) {
    throw new WizardError(`${id} selected source must declare tested variants`);
  }
  for (const projection of selected) {
    if ("unmapped" in projection.via) {
      throw new WizardError(`${id}.${projection.id} selected projection cannot be unmapped`);
    }
  }
  if (!Array.isArray(item.path_cases)) throw new WizardError(`${id}.path_cases must be an array`);
  const path_cases = item.path_cases.map((raw, index) => {
    const pathCase = record(raw, `${id}.path_cases.${index}`);
    onlyKeys(
      pathCase,
      ["artifact_id", "object_path", "member_path", "matches", "call_id"],
      `${id}.path_cases.${index}`,
    );
    if (typeof pathCase.matches !== "boolean") {
      throw new WizardError(`${id}.path_cases.${index}.matches must be boolean`);
    }
    return {
      artifact_id: nonempty(pathCase.artifact_id, `${id}.path_cases.${index}.artifact_id`, 128),
      object_path: nonempty(pathCase.object_path, `${id}.path_cases.${index}.object_path`, 1024),
      member_path:
        pathCase.member_path === undefined || pathCase.member_path === null
          ? pathCase.member_path
          : nonempty(pathCase.member_path, `${id}.path_cases.${index}.member_path`, 1024),
      matches: pathCase.matches,
      call_id:
        pathCase.call_id === undefined
          ? undefined
          : nonempty(pathCase.call_id, `${id}.path_cases.${index}.call_id`, 256),
    };
  });
  return {
    id,
    producer: {
      file,
      symbol,
    },
    artifact_ids,
    mapper_ids,
    format: {
      decoder: enumValue(
        format.decoder,
        ["otlp_json", "otlp_protobuf", "json", "jsonl", "csv", "text", "audio"] as const,
        `${id}.format.decoder`,
      ),
      cardinality: enumValue(
        format.cardinality,
        ["one", "many"] as const,
        `${id}.format.cardinality`,
      ),
      description: nonempty(format.description, `${id}.format.description`, 2048),
      variants,
      projections,
    },
    path_cases,
  };
}

export function validateMappingPlan(value: unknown, manifest: IntegrationManifest): MappingPlan {
  const item = record(value, "mapping plan");
  onlyKeys(item, ["schema", "version", "requirements", "sources", "overlaps"], "mapping plan");
  if (item.schema !== MAPPING_PLAN_SCHEMA || item.version !== 1) {
    throw new WizardError("mapping plan requires schema pulse.mapping-plan version 1");
  }
  const sourceIds = new Set<string>();
  if (!Array.isArray(item.sources) || !item.sources.length) {
    throw new WizardError("mapping plan sources must not be empty");
  }
  const sources = item.sources.map((source) => validateSource(source, sourceIds));
  const artifacts = new Map(manifest.artifacts.map((artifact) => [artifact.id, artifact]));
  for (const source of sources) {
    for (const id of source.artifact_ids) {
      const artifact = artifacts.get(id);
      if (!artifact) throw new WizardError(`${source.id} references unknown artifact ${id}`);
      if (artifact.decoder.type !== source.format.decoder) {
        throw new WizardError(`${source.id} format ${source.format.decoder} disagrees with ${id}`);
      }
      if (source.format.cardinality === "many" && artifact.correlation.call_id.from !== "mapper") {
        throw new WizardError(`${source.id} multi-call artifacts require mapper correlation`);
      }
    }
    for (const id of source.mapper_ids) {
      const mapper = manifest.mappers[id];
      if (!mapper) throw new WizardError(`${source.id} references unknown mapper ${id}`);
      if (mapper.cardinality !== source.format.cardinality) {
        throw new WizardError(`${source.id} cardinality disagrees with mapper ${id}`);
      }
    }
    for (const projection of source.format.projections) {
      if ("mapper" in projection.via && !source.mapper_ids.includes(projection.via.mapper)) {
        throw new WizardError(`${source.id}.${projection.id} uses an unlisted mapper`);
      }
      if ("artifact" in projection.via && !source.artifact_ids.includes(projection.via.artifact)) {
        throw new WizardError(`${source.id}.${projection.id} uses an unlisted artifact`);
      }
    }
  }
  const plannedArtifacts = new Set(sources.flatMap(({ artifact_ids }) => artifact_ids));
  const plannedMappers = new Set(sources.flatMap(({ mapper_ids }) => mapper_ids));
  for (const id of artifacts.keys()) {
    if (!plannedArtifacts.has(id))
      throw new WizardError(`manifest artifact ${id} is absent from mapping plan`);
  }
  for (const id of Object.keys(manifest.mappers)) {
    if (!plannedMappers.has(id))
      throw new WizardError(`manifest mapper ${id} is absent from mapping plan`);
  }

  const requirementsRaw = record(item.requirements, "mapping plan requirements");
  const expectedFields = canonicalFieldIds();
  const expectedSet = new Set(expectedFields);
  const missing = expectedFields.filter((field) => !(field in requirementsRaw));
  const extra = Object.keys(requirementsRaw).filter((field) => !expectedSet.has(field));
  if (missing.length)
    throw new WizardError(`mapping plan omits canonical fields: ${missing.join(", ")}`);
  if (extra.length)
    throw new WizardError(`mapping plan has unknown canonical fields: ${extra.join(", ")}`);
  const requirements: Record<string, RequirementDecision> = {};
  for (const field of expectedFields) {
    const requirement = record(requirementsRaw[field], `requirements.${field}`);
    onlyKeys(requirement, ["status", "sources", "reason"], `requirements.${field}`);
    const status = enumValue(
      requirement.status,
      REQUIREMENT_STATUSES,
      `requirements.${field}.status`,
    );
    const selectedSources =
      requirement.sources === undefined
        ? undefined
        : stringArray(requirement.sources, `requirements.${field}.sources`);
    if (status === "mapped") {
      if (!selectedSources?.length) throw new WizardError(`${field} is mapped without a source`);
      for (const source of selectedSources) {
        if (!sourceIds.has(source))
          throw new WizardError(`${field} references unknown source ${source}`);
      }
      if (requirement.reason !== undefined) {
        throw new WizardError(`${field} mapped requirements must not have a reason`);
      }
    } else {
      if (selectedSources?.length)
        throw new WizardError(`${field} ${status} must not select sources`);
      nonempty(requirement.reason, `requirements.${field}.reason`, 2048);
    }
    requirements[field] = {
      status,
      sources: selectedSources,
      reason: requirement.reason as string | undefined,
    };
  }

  if (!Array.isArray(item.overlaps))
    throw new WizardError("mapping plan overlaps must be an array");
  const overlaps = item.overlaps.map((raw, index) => {
    const overlap = record(raw, `overlaps.${index}`);
    onlyKeys(
      overlap,
      ["canonical_fields", "candidates", "selected", "confirmed"],
      `overlaps.${index}`,
    );
    const canonical_fields = stringArray(
      overlap.canonical_fields,
      `overlaps.${index}.canonical_fields`,
    );
    const candidates = stringArray(overlap.candidates, `overlaps.${index}.candidates`);
    if (!canonical_fields.length || candidates.length < 2) {
      throw new WizardError(`overlaps.${index} requires fields and at least two candidates`);
    }
    for (const field of canonical_fields) {
      if (!expectedSet.has(field))
        throw new WizardError(`overlaps.${index} uses unknown field ${field}`);
    }
    for (const candidate of candidates) {
      if (!sourceIds.has(candidate))
        throw new WizardError(`overlaps.${index} uses unknown source ${candidate}`);
    }
    const selected = nonempty(overlap.selected, `overlaps.${index}.selected`, 128);
    if (!candidates.includes(selected))
      throw new WizardError(`overlaps.${index} selected source is not a candidate`);
    if (overlap.confirmed !== true)
      throw new WizardError(`overlaps.${index} is not user-confirmed`);
    return { canonical_fields, candidates, selected, confirmed: true as const };
  });

  const projections = new Map<string, Array<{ source: string; use: SourceProjection["use"] }>>();
  for (const source of sources) {
    for (const projection of source.format.projections) {
      for (const field of projection.canonical_fields) {
        projections.set(field, [
          ...(projections.get(field) ?? []),
          { source: source.id, use: projection.use },
        ]);
      }
    }
  }
  for (const field of expectedFields) {
    const candidates = projections.get(field) ?? [];
    const selected = [
      ...new Set(candidates.filter(({ use }) => use === "selected").map(({ source }) => source)),
    ];
    const declared = requirements[field]!;
    if (declared.status === "mapped") {
      const required = [...(declared.sources ?? [])].sort();
      if (JSON.stringify(selected.sort()) !== JSON.stringify(required)) {
        throw new WizardError(
          `${field} selected projections disagree with its requirement sources`,
        );
      }
    } else if (selected.length) {
      throw new WizardError(`${field} has selected projections but is ${declared.status}`);
    }
    const allSources = [...new Set(candidates.map(({ source }) => source))];
    if (allSources.length > 1 && !isCorrelationField(field)) {
      const decision = overlaps.find((overlap) => overlap.canonical_fields.includes(field));
      if (!decision)
        throw new WizardError(`${field} has duplicate sources without a confirmed choice`);
      if (!allSources.every((source) => decision.candidates.includes(source))) {
        throw new WizardError(`${field} overlap does not include every candidate`);
      }
      if (!selected.includes(decision.selected) || selected.length !== 1) {
        throw new WizardError(`${field} must select only the confirmed source`);
      }
    }
  }
  return { schema: MAPPING_PLAN_SCHEMA, version: 1, requirements, sources, overlaps };
}

export function validateMappingCase(value: unknown, source: SourceFormat): MappingCase {
  const item = record(value, `case for ${source.id}`);
  onlyKeys(
    item,
    ["schema", "version", "source", "variant", "input", "expected"],
    `case for ${source.id}`,
  );
  if (item.schema !== "pulse.mapping-case" || item.version !== 1) {
    throw new WizardError(`${source.id} case requires schema pulse.mapping-case version 1`);
  }
  if (item.source !== source.id) throw new WizardError(`${source.id} case names the wrong source`);
  const variant = nonempty(item.variant, `${source.id} case variant`, 128);
  if (!source.format.variants.some(({ id }) => id === variant)) {
    throw new WizardError(`${source.id} case uses unknown variant ${variant}`);
  }
  const expected = record(item.expected, `${source.id} case expected`);
  const expectedIds = Object.keys(expected).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify([...source.mapper_ids].sort())) {
    throw new WizardError(`${source.id} case expected outputs must match its mapper_ids`);
  }
  return {
    schema: "pulse.mapping-case",
    version: 1,
    source: source.id,
    variant,
    input: item.input,
    expected,
  };
}
