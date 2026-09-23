import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import jsonata from "jsonata";
import { WizardError } from "../util/errors.js";
import {
  type CanonicalFragment,
  type Capability,
  type IntegrationManifest,
  type MapperDefinition,
  type MapperTarget,
  SPAN_ATTR_VOCABULARY,
  type TraceFragment,
  validateCanonicalFragment,
  validateManifest,
} from "./manifest.js";
import {
  type MappingPlan,
  type SourceFormat,
  validateMappingCase,
  validateMappingPlan,
} from "./mappingPlan.js";

const MAX_ARTIFACT_BYTES = 5_000_000;

interface MapperEnvelope {
  _pulse: {
    call_id: string | null;
    object_path?: string | null;
    member_path?: string | null;
  };
  data: unknown;
}

export interface IntegrationValidation {
  manifest: IntegrationManifest;
  plan: MappingPlan;
  fragments: Record<string, CanonicalFragment[]>;
  coverage: Record<string, Capability>;
}

async function readJson(path: string): Promise<unknown> {
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > MAX_ARTIFACT_BYTES)
    throw new WizardError(`${path} is too large`);
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new WizardError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}

function validateEnvelope(
  value: unknown,
  sourceId: string,
  cardinality: "one" | "many",
): MapperEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WizardError(`${sourceId} case input must be a standard mapper envelope`);
  }
  const envelope = value as Record<string, unknown>;
  if (!Object.hasOwn(envelope, "data"))
    throw new WizardError(`${sourceId} case input is missing data`);
  if (!envelope._pulse || typeof envelope._pulse !== "object" || Array.isArray(envelope._pulse)) {
    throw new WizardError(`${sourceId} case input is missing _pulse context`);
  }
  const context = envelope._pulse as Record<string, unknown>;
  if (cardinality === "one" && (typeof context.call_id !== "string" || !context.call_id.trim())) {
    throw new WizardError(`${sourceId} single-call input requires _pulse.call_id`);
  }
  if (context.call_id !== null && typeof context.call_id !== "string") {
    throw new WizardError(`${sourceId} _pulse.call_id must be a string or null`);
  }
  for (const field of ["object_path", "member_path"] as const) {
    if (
      context[field] !== undefined &&
      context[field] !== null &&
      typeof context[field] !== "string"
    ) {
      throw new WizardError(`${sourceId} _pulse.${field} must be a string or null`);
    }
  }
  return value as MapperEnvelope;
}

function validateMapperResult(
  value: unknown,
  mapper: MapperDefinition,
  field: string,
): CanonicalFragment[] {
  if (mapper.cardinality === "many") {
    if (!Array.isArray(value) || !value.length)
      throw new WizardError(`${field} must be a nonempty array`);
    return value.map((fragment) => validateCanonicalFragment(fragment, mapper.output));
  }
  if (Array.isArray(value)) throw new WizardError(`${field} must emit one canonical fragment`);
  return [validateCanonicalFragment(value, mapper.output)];
}

async function evaluateMapper(
  id: string,
  mapper: MapperDefinition,
  input: MapperEnvelope,
): Promise<CanonicalFragment[]> {
  try {
    const value = await jsonata(mapper.expression).evaluate(input);
    return validateMapperResult(value, mapper, `mapper ${id}`);
  } catch (error) {
    if (error instanceof WizardError) throw error;
    throw new WizardError(`mapper ${id} failed: ${(error as Error).message}`);
  }
}

function fragmentFields(target: MapperTarget, fragment: CanonicalFragment): Set<string> {
  const fields = new Set<string>();
  if (target === "call") {
    for (const key of Object.keys(fragment)) fields.add(`CallHeader.${key}`);
    return fields;
  }
  if (target === "trace") {
    const trace = fragment as TraceFragment;
    fields.add("TraceEvidence.call_id");
    fields.add("TraceEvidence.spans");
    if (trace.header) {
      fields.add("TraceEvidence.header");
      for (const key of Object.keys(trace.header)) fields.add(`CallHeader.${key}`);
    }
    for (const span of trace.spans) {
      for (const key of Object.keys(span)) fields.add(`Span.${key}`);
      for (const event of span.events) {
        for (const key of Object.keys(event)) fields.add(`SpanEvent.${key}`);
      }
    }
    return fields;
  }
  fields.add("Transcript.call_id");
  fields.add("Transcript.turns");
  const turns = (fragment as unknown as { turns: Array<Record<string, unknown>> }).turns;
  for (const turn of turns) {
    for (const key of Object.keys(turn)) fields.add(`TranscriptTurn.${key}`);
  }
  return fields;
}

function artifactFields(manifest: IntegrationManifest, artifactId: string): Set<string> {
  const artifact = manifest.artifacts.find(({ id }) => id === artifactId);
  if (!artifact) return new Set();
  const fields = new Set<string>();
  for (const emit of artifact.emits) {
    if (emit.target !== "audio") continue;
    for (const field of [
      "AudioEvidence.call_id",
      "AudioEvidence.audio",
      "AudioRef.uri",
      "AudioRef.sha256",
      "AudioRef.channels",
      "AudioRef.sample_rate",
      "AudioRef.duration_s",
      "AudioRef.channel_map",
    ]) {
      fields.add(field);
    }
    if (emit.config.t0_offset_s !== undefined) fields.add("AudioRef.t0_offset_s");
  }
  return fields;
}

function validatePathCases(source: SourceFormat, manifest: IntegrationManifest): void {
  const artifacts = new Map(manifest.artifacts.map((artifact) => [artifact.id, artifact]));
  for (const id of source.artifact_ids) {
    const cases = source.path_cases.filter(({ artifact_id }) => artifact_id === id);
    if (!cases.some(({ matches }) => matches) || !cases.some(({ matches }) => !matches)) {
      throw new WizardError(`${source.id}.${id} requires positive and negative path cases`);
    }
  }
  for (const [index, pathCase] of source.path_cases.entries()) {
    if (!source.artifact_ids.includes(pathCase.artifact_id)) {
      throw new WizardError(`${source.id}.path_cases.${index} references an unlisted artifact`);
    }
    const artifact = artifacts.get(pathCase.artifact_id)!;
    const objectMatch = new RegExp(artifact.selector.object_path_regex).exec(pathCase.object_path);
    const memberMatch = artifact.selector.member_path_regex
      ? new RegExp(artifact.selector.member_path_regex).exec(pathCase.member_path ?? "")
      : null;
    const matched = Boolean(objectMatch && (!artifact.selector.member_path_regex || memberMatch));
    if (matched !== pathCase.matches) {
      throw new WizardError(`${source.id}.path_cases.${index} contradicts ${pathCase.artifact_id}`);
    }
    if (!matched) continue;
    const resolver = artifact.correlation.call_id;
    if (resolver.from === "path_capture") {
      const match = resolver.scope === "object" ? objectMatch : memberMatch;
      const actual = match?.[resolver.group];
      if (!pathCase.call_id || actual !== pathCase.call_id) {
        throw new WizardError(`${source.id}.path_cases.${index} extracts the wrong call_id`);
      }
    }
  }
}

function capability(
  status: Capability["status"],
  evidence: string[],
  missing?: string[],
): Capability {
  return { status, evidence: [...new Set(evidence)].sort(), missing };
}

function traceFacts(traces: TraceFragment[]) {
  const stages = new Set<string>();
  const attrs = new Set<string>();
  const events = new Set<string>();
  let transcriptContent = false;
  for (const trace of traces) {
    for (const span of trace.spans) {
      stages.add(span.stage);
      for (const key of Object.keys(span.attrs)) attrs.add(key);
      if (Object.keys(span.content).some((key) => /transcript|text|prompt|response/i.test(key))) {
        transcriptContent = true;
      }
      for (const event of span.events) events.add(event.name);
    }
  }
  return { stages, attrs, events, transcriptContent };
}

function deriveCoverage(
  manifest: IntegrationManifest,
  fragments: Record<string, CanonicalFragment[]>,
): Record<string, Capability> {
  const byTarget = new Map<MapperTarget, string[]>();
  for (const [id, mapper] of Object.entries(manifest.mappers)) {
    byTarget.set(mapper.output, [...(byTarget.get(mapper.output) ?? []), id]);
  }
  const traces = Object.entries(fragments).flatMap(([id, values]) =>
    manifest.mappers[id]?.output === "trace" ? (values as TraceFragment[]) : [],
  );
  const facts = traceFacts(traces);
  const audio = manifest.artifacts.flatMap((artifact) =>
    artifact.emits
      .filter((emit) => emit.target === "audio")
      .map((emit) => ({
        id: artifact.id,
        config: emit.target === "audio" ? emit.config : neverValue(),
      })),
  );
  const separatedAudio = audio.some(
    ({ config }) => config.layout === "stereo" || config.layout === "dual_mono",
  );
  const transcriptEvidence = byTarget.get("transcript") ?? [];
  const hasTranscript = transcriptEvidence.length > 0 || facts.transcriptContent;
  const traceEvidence = byTarget.get("trace") ?? [];
  const result: Record<string, Capability> = {};
  result.call_identity =
    byTarget.has("call") || traces.length
      ? capability("available", [...(byTarget.get("call") ?? []), ...traceEvidence])
      : capability("unavailable", [], ["canonical call_id"]);
  result.trace = traces.length
    ? capability("available", traceEvidence)
    : capability("unavailable", [], ["canonical spans"]);
  result.transcript = hasTranscript
    ? capability("available", transcriptEvidence.length ? transcriptEvidence : traceEvidence)
    : capability("unavailable", [], ["speaker-attributed transcript"]);
  result.audio_analysis = audio.length
    ? capability(
        separatedAudio ? "available" : "partial",
        audio.map(({ id }) => id),
        separatedAudio ? undefined : ["separated caller and agent channels"],
      )
    : capability("unavailable", [], ["call-linked audio"]);
  result.root_cause_analysis =
    hasTranscript && traces.length
      ? capability("available", [...transcriptEvidence, ...traceEvidence])
      : capability(
          hasTranscript || traces.length ? "partial" : "unavailable",
          [...transcriptEvidence, ...traceEvidence],
          [...(hasTranscript ? [] : ["transcript"]), ...(traces.length ? [] : ["trace"])],
        );

  // Coverage states EVIDENCE, never derived metrics — which numbers Pulse can compute
  // from this evidence is Pulse's knowledge, not the wizard's (it would rot here).
  const timedSpans = traces.some((trace) =>
    trace.spans.some((span) => span.t_start !== null && span.t_start !== undefined),
  );
  const untimedSpans = traces.some((trace) =>
    trace.spans.some((span) => span.t_start === null || span.t_start === undefined),
  );
  result.timed_spans = timedSpans
    ? capability("available", traceEvidence)
    : capability(
        "unavailable",
        [],
        [untimedSpans ? "a source with a clock (spans present, untimed)" : "canonical spans"],
      );
  if (untimedSpans) result.untimed_spans = capability("available", traceEvidence);
  // Which canonical span attrs the mappers actually observed — evidence, listed by name.
  const observedAttrs = Object.keys(SPAN_ATTR_VOCABULARY).filter((name) => facts.attrs.has(name));
  if (observedAttrs.length) {
    result.span_attrs = capability("available", traceEvidence);
    result.span_attrs.missing = Object.keys(SPAN_ATTR_VOCABULARY).filter(
      (name) => !facts.attrs.has(name),
    );
    result.span_attrs.evidence = observedAttrs;
  }
  return result;
}

function neverValue(): never {
  throw new Error("unreachable");
}

export async function validateIntegration(repo: string): Promise<IntegrationValidation> {
  const root = join(repo, ".pulse", "artifacts", "integration");
  const manifestPath = join(root, "manifest.json");
  const manifest = validateManifest(await readJson(manifestPath));
  const plan = validateMappingPlan(await readJson(join(root, "mapping-plan.json")), manifest);
  const fragments: Record<string, CanonicalFragment[]> = {};
  const observedFields = new Map<string, Set<string>>();

  for (const source of plan.sources) {
    const producerPath = join(repo, source.producer.file);
    await access(producerPath).catch(() => {
      throw new WizardError(`${source.id} producer file does not exist: ${source.producer.file}`);
    });
    const producer = await readFile(producerPath, "utf8");
    const symbol = source.producer.symbol.split(".").at(-1)!;
    if (!new RegExp(`\\b${symbol}\\b`).test(producer)) {
      throw new WizardError(
        `${source.id} producer symbol does not exist: ${source.producer.symbol}`,
      );
    }
    validatePathCases(source, manifest);
    for (const variant of source.format.variants) {
      for (const caseId of variant.cases) {
        const path = join(root, "fixtures", source.id, `${caseId}.json`);
        const mappingCase = validateMappingCase(await readJson(path), source);
        if (mappingCase.variant !== variant.id) {
          throw new WizardError(`${source.id}/${caseId} declares the wrong variant`);
        }
        const input = validateEnvelope(mappingCase.input, source.id, source.format.cardinality);
        for (const mapperId of source.mapper_ids) {
          const mapper = manifest.mappers[mapperId]!;
          const actual = await evaluateMapper(mapperId, mapper, input);
          const expected = validateMapperResult(
            mappingCase.expected[mapperId],
            mapper,
            `${source.id}/${caseId} expected ${mapperId}`,
          );
          const comparableActual = JSON.parse(JSON.stringify(actual));
          const comparableExpected = JSON.parse(JSON.stringify(expected));
          if (!isDeepStrictEqual(comparableActual, comparableExpected)) {
            throw new WizardError(
              `${source.id}/${caseId} mapper ${mapperId} does not match expected output`,
            );
          }
          if (mapper.cardinality === "one" && input._pulse.call_id) {
            if (actual[0]?.call_id !== input._pulse.call_id) {
              throw new WizardError(`mapper ${mapperId} must propagate _pulse.call_id`);
            }
            const probe = structuredClone(input);
            probe._pulse.call_id = `pulse-correlation-check-${mapperId}`;
            const probeFragments = await evaluateMapper(mapperId, mapper, probe);
            if (probeFragments[0]?.call_id !== probe._pulse.call_id) {
              throw new WizardError(
                `mapper ${mapperId} hardcodes call_id instead of using _pulse.call_id`,
              );
            }
          }
          fragments[mapperId] = [...(fragments[mapperId] ?? []), ...actual];
          const fields = observedFields.get(mapperId) ?? new Set<string>();
          for (const fragment of actual) {
            for (const field of fragmentFields(mapper.output, fragment)) fields.add(field);
          }
          observedFields.set(mapperId, fields);
        }
      }
    }
  }

  for (const source of plan.sources) {
    for (const projection of source.format.projections) {
      if (projection.use !== "selected") continue;
      const fields =
        "mapper" in projection.via
          ? (observedFields.get(projection.via.mapper) ?? new Set<string>())
          : "artifact" in projection.via
            ? artifactFields(manifest, projection.via.artifact)
            : new Set<string>();
      const missing = projection.canonical_fields.filter((field) => !fields.has(field));
      if (missing.length) {
        throw new WizardError(
          `${source.id}.${projection.id} mapper output omits: ${missing.join(", ")}`,
        );
      }
    }
  }
  for (const [mapperId, fields] of observedFields) {
    const declared = new Set(
      plan.sources.flatMap((source) =>
        source.format.projections.flatMap((projection) =>
          projection.use === "selected" &&
          "mapper" in projection.via &&
          projection.via.mapper === mapperId
            ? projection.canonical_fields
            : [],
        ),
      ),
    );
    const undocumented = [...fields].filter((field) => !declared.has(field));
    if (undocumented.length) {
      throw new WizardError(
        `${mapperId} emits undeclared canonical fields: ${undocumented.join(", ")}`,
      );
    }
  }

  const coverage = deriveCoverage(manifest, fragments);
  const finalized = validateManifest({ ...manifest, expected_capabilities: coverage });
  await writeFile(manifestPath, `${JSON.stringify(finalized, null, 2)}\n`);
  await writeFile(
    join(root, "coverage.json"),
    `${JSON.stringify({ schema: "pulse.integration.coverage", version: 1, capabilities: coverage }, null, 2)}\n`,
  );
  return { manifest: finalized, plan, fragments, coverage };
}
