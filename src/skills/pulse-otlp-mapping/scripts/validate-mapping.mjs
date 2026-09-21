#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import jsonata from "jsonata";

const STAGES = new Set([
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
]);
const TURN_STAGES = new Set(["turn", "speech", "stt", "llm", "tts", "playout"]);
const CANONICAL_SECONDS = [
  "metrics.ttft",
  "metrics.ttfb",
  "metrics.e2e_latency",
  "endpointing.delay",
];

function usage() {
  console.error(
    "usage: validate-mapping.mjs <mapping.jsonata> <sample.json> " +
      "[canonical-trace.json] [coverage.json] [otlp|json_log]",
  );
  process.exit(2);
}

const [mappingPath, samplePath, tracePath, coveragePath, sourceKind = "otlp"] =
  process.argv.slice(2);
if (!mappingPath || !samplePath) usage();
if (!["otlp", "json_log"].includes(sourceKind)) usage();

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const present = (value) => value !== undefined && value !== null && value !== "";

function validate(trace) {
  const errors = [];
  const warnings = [];
  if (!object(trace)) return { errors: ["result must be an object"], warnings, coverage: {} };

  const header = trace.header;
  if (!object(header)) errors.push("header must be an object");
  for (const key of ["call_id", "source", "environment", "started_at"]) {
    if (!present(header?.[key]) || typeof header[key] !== "string") {
      errors.push(`header.${key} must be a non-empty string`);
    }
  }
  if (present(header?.started_at) && Number.isNaN(Date.parse(header.started_at))) {
    errors.push("header.started_at must be ISO-8601");
  }
  if (present(header?.ended_at) && Number.isNaN(Date.parse(header.ended_at))) {
    errors.push("header.ended_at must be ISO-8601 or null");
  }
  if (!Array.isArray(trace.spans) || trace.spans.length === 0) {
    errors.push("spans must be a non-empty array");
    return { errors, warnings, coverage: {} };
  }

  const ids = new Set();
  const turnAnchors = new Set();
  for (const [index, span] of trace.spans.entries()) {
    const at = `spans[${index}]`;
    if (!object(span)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (!present(span.span_id) || typeof span.span_id !== "string") {
      errors.push(`${at}.span_id must be a non-empty string`);
    } else if (ids.has(span.span_id)) {
      errors.push(`${at}.span_id is duplicated: ${span.span_id}`);
    } else {
      ids.add(span.span_id);
    }
    if (!STAGES.has(span.stage)) errors.push(`${at}.stage is invalid: ${span.stage}`);
    if (!finite(span.t_start)) errors.push(`${at}.t_start must be a finite number`);
    if (span.t_end !== null && !finite(span.t_end))
      errors.push(`${at}.t_end must be a number or null`);
    if (finite(span.t_start) && span.t_start < -0.001)
      warnings.push(`${at}.t_start is before call root`);
    if (finite(span.t_end) && finite(span.t_start) && span.t_end < span.t_start) {
      errors.push(`${at}.t_end precedes t_start`);
    }
    if (TURN_STAGES.has(span.stage) && !present(span.turn_id)) {
      errors.push(`${at} (${span.stage}) requires explicit turn_id`);
    }
    if (span.stage === "turn" && present(span.turn_id)) turnAnchors.add(String(span.turn_id));
    if (!object(span.attrs)) errors.push(`${at}.attrs must be an object`);
    if (!object(span.content)) errors.push(`${at}.content must be an object`);
    const eventsIsArray = Array.isArray(span.events);
    if (span.events !== undefined && !eventsIsArray) {
      errors.push(
        `${at}.events must be an array (JSONata returns a single object for one match — force an array with [ ])`,
      );
    }
    for (const key of CANONICAL_SECONDS) {
      if (present(span.attrs?.[key]) && !finite(span.attrs[key])) {
        errors.push(`${at}.attrs.${key} must be a finite number in seconds`);
      }
    }
    for (const [eventIndex, event] of (eventsIsArray ? span.events : []).entries()) {
      const eventAt = `${at}.events[${eventIndex}]`;
      if (!object(event) || !present(event.name)) errors.push(`${eventAt}.name is required`);
      if (!finite(event?.t)) errors.push(`${eventAt}.t must be a finite relative-second value`);
      if (!object(event?.attrs)) errors.push(`${eventAt}.attrs must be an object`);
      if (!object(event?.content)) errors.push(`${eventAt}.content must be an object`);
    }
  }

  for (const [index, span] of trace.spans.entries()) {
    if (
      TURN_STAGES.has(span.stage) &&
      present(span.turn_id) &&
      !turnAnchors.has(String(span.turn_id))
    ) {
      errors.push(`spans[${index}].turn_id has no matching turn anchor: ${span.turn_id}`);
    }
    if (present(span.parent_span_id) && !ids.has(span.parent_span_id)) {
      warnings.push(
        `spans[${index}].parent_span_id is absent from this payload: ${span.parent_span_id}`,
      );
    }
  }

  const unknown = trace.spans.filter((span) => span.stage === "unknown").length;
  if (unknown) warnings.push(`${unknown} span(s) remain stage=unknown`);

  return { errors, warnings, coverage: metricCoverage(trace.spans) };
}

function validateInput(sample) {
  if (sourceKind === "json_log") {
    return (object(sample) && Object.keys(sample).length) ||
      (Array.isArray(sample) && sample.length)
      ? []
      : ["JSON log input must be a non-empty object or array"];
  }
  if (!object(sample) || !Array.isArray(sample.resourceSpans)) {
    return ["input must be an OTLP ExportTraceServiceRequest with resourceSpans"];
  }
  const spans = (sample.resourceSpans ?? []).flatMap((resource) =>
    (resource.scopeSpans ?? []).flatMap((scope) => scope.spans ?? []),
  );
  const traceIds = new Set(
    spans
      .map((span) => span.traceId)
      .filter(present)
      .map(String),
  );
  if (spans.length === 0) return ["input contains no OTLP spans"];
  if (traceIds.size !== 1) {
    return [`input must contain exactly one distinct traceId; found ${traceIds.size}`];
  }
  return [];
}

function metricCoverage(spans) {
  const hasStage = (stage, complete = false) =>
    spans.some((span) => span.stage === stage && (!complete || finite(span.t_end)));
  const hasAttr = (stage, key) =>
    spans.some((span) => span.stage === stage && present(span.attrs?.[key]));
  const hasContent = (key) => spans.some((span) => present(span.content?.[key]));
  const hasEvent = (name) =>
    spans.some(
      (span) => Array.isArray(span.events) && span.events.some((event) => event.name === name),
    );
  const result = {};
  const set = (name, status, evidence) => {
    result[name] = { status, evidence };
  };

  const speechEnd = hasStage("speech", true);
  const sttEnd = hasStage("stt", true);
  const tts = hasStage("tts");
  const firstAudio = hasEvent("tts.first_audio");
  const reportedTtfb = hasAttr("tts", "metrics.ttfb");
  set(
    "response_latency",
    speechEnd && firstAudio
      ? "available"
      : (speechEnd || sttEnd) && tts
        ? "degraded"
        : "unavailable",
    speechEnd && firstAudio
      ? ["speech.t_end", "tts.first_audio"]
      : ["caller-stop fallback", "tts fallback"],
  );
  set("stt_lag", hasStage("stt", true) ? "available" : "unavailable", ["stt.t_start", "stt.t_end"]);
  set(
    "endpointing",
    speechEnd && hasStage("stt")
      ? "available"
      : hasAttr("turn", "endpointing.delay")
        ? "degraded"
        : "unavailable",
    speechEnd && hasStage("stt") ? ["speech.t_end", "stt.t_start"] : ["endpointing.delay"],
  );
  const firstToken = hasEvent("llm.first_token");
  const reportedTtft = hasAttr("llm", "metrics.ttft");
  set("llm_ttft", firstToken ? "available" : reportedTtft ? "degraded" : "unavailable", [
    firstToken ? "llm.first_token" : "metrics.ttft",
  ]);
  set(
    "assembly",
    firstToken && tts ? "available" : reportedTtft && tts ? "degraded" : "unavailable",
    [firstToken ? "llm.first_token" : "reconstructed first token", "tts.t_start"],
  );
  set(
    "dispatch",
    firstToken && hasAttr("tts", "tts.chars")
      ? "available"
      : reportedTtft && hasAttr("tts", "tts.chars")
        ? "degraded"
        : "unavailable",
    [firstToken ? "llm.first_token" : "reconstructed first token", "tts span carrying tts.chars"],
  );
  set("tts_ttfb", firstAudio ? "available" : reportedTtfb ? "degraded" : "unavailable", [
    firstAudio ? "tts.first_audio" : "metrics.ttfb",
  ]);
  set("tokens", hasAttr("llm", "gen_ai.usage.output_tokens") ? "available" : "unavailable", [
    "gen_ai.usage.output_tokens",
  ]);
  set(
    "truncation",
    hasAttr("tts", "tts.chars") && hasAttr("tts", "tts.chars_cut") ? "available" : "unavailable",
    ["tts.chars", "tts.chars_cut"],
  );
  set("transcript", hasContent("transcript") ? "available" : "unavailable", ["content.transcript"]);
  set("agent_text", hasContent("llm_spoken") ? "available" : "unavailable", ["content.llm_spoken"]);

  result.scenarios = {
    interruption: spans.some((span) => span.attrs?.["turn.interrupted"] === true)
      ? "tested"
      : "untested",
    tool: hasStage("tool") ? "tested" : "untested",
    error: spans.some((span) => span.error === true) ? "tested" : "untested",
    multi_turn:
      new Set(spans.map((span) => span.turn_id).filter(present)).size > 1 ? "tested" : "untested",
  };
  return result;
}

try {
  const [source, sampleSource] = await Promise.all([
    readFile(mappingPath, "utf8"),
    readFile(samplePath, "utf8"),
  ]);
  const sample = JSON.parse(sampleSource);
  const inputErrors = validateInput(sample);
  if (inputErrors.length) {
    console.error(JSON.stringify({ errors: inputErrors }, null, 2));
    process.exit(1);
  }
  const trace = await jsonata(source).evaluate(sample);
  const report = validate(trace);

  if (tracePath) await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`);
  if (coveragePath) await writeFile(coveragePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
} catch (error) {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "object"
        ? JSON.stringify(error)
        : String(error);
  console.error(`mapping validation failed: ${detail}`);
  process.exitCode = 1;
}
