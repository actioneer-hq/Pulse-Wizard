---
name: pulse-otlp-mapping
description: >-
  Discover voice telemetry and call-linked JSON logs, choose a primary source with the developer,
  and map its JSON into Pulse's canonical Trace. Ask before wiring an unconfigured OTLP exporter.
  Use pulse-storage-mapping for blob object-key rules.
license: MIT
---

# Map voice-agent signals into Pulse

The goal is to connect the **target voice-agent application** to Pulse observability. Inspect
the application's telemetry producers, exported call traces, and persisted call-linked logs. `.pulse/` is Wizard
working state inside the checkout, not application source. Prior mappings, samples, and coverage
reports there are not proof that the app emits those spans. Use them to resume work only after
establishing provenance from producer code; distinguish captures from code-derived samples.

Run inside the developer's own coding agent after `pulse-wizard init`. Read `.pulse/SETUP.md`
for the exact local CLI commands. Do not read `.pulse/config.json` or print a token; the CLI
handles authentication. Write artifacts under `.pulse/artifacts/otlp/`. Ask the developer in
this agent UI when evidence or semantics need confirmation.

# Primary source decision

Inspect the application and storage producer code before mapping. Classify telemetry precisely:

- Voice-stage spans are produced **and exported**: OTLP is a candidate source.
- Voice-stage spans are produced but no trace exporter is configured or invoked: ask permission
  to wire export, then treat OTLP as pending a real run. A `TracerProvider` alone is not evidence
  that voice stages are traced.
- No voice-stage spans are produced: look for call-linked JSON logs in blob storage using
  `pulse-storage-mapping`. Prefer the most complete log by call identity, timing, stage semantics,
  and producer evidence; give its full bucket-relative key expression and storage rule ID.

If usable OTLP and call-linked JSON logs both exist, ask the developer which **one** to use as
the primary canonical trace source. Do not silently choose. Logs can still be inventoried as
other storage artifacts. If neither source can represent a call, report that full trace analytics
are unavailable; audio-only analysis may still be possible.

Produce one total JSONata expression transforming the chosen source JSON into Pulse's canonical
`Trace`. Pulse's metric engine stays fixed. Missing source signals must stay missing. Arbitrary
JSON is mappable only when its producer semantics support the required call/turn relationships;
JSONata syntax alone cannot create those facts.

For OTLP, input is a call-sharded `ExportTraceServiceRequest` with one `traceId`. For JSON logs,
input is the producer's completed-call JSON object/array. If one blob contains multiple calls,
select one record for the local mapping sample and document the `records_pointer` and call-ID
resolver in the storage manifest; Pulse must apply the same selection at runtime.

## Exporter setup

If voice spans exist without export, show the developer the evidence and ask whether you may
modify the application to add an OTLP/HTTP trace exporter. Only after approval, use the repo's
existing OpenTelemetry SDK and initialization pattern. Configure the **exact traces endpoint**
`${PULSE_OTLP_TRACES_ENDPOINT}` (Pulse `/v1/traces`), send the ingest token in the
`Authorization: Bearer` or `X-Voiceobs-Token` header, and send `X-Voiceobs-Org` when the org is
not `default`. Name the application environment variables for endpoint, token, and optional org;
never place token values in source, `.env.example`, logs, or `.pulse/` artifacts. Preserve existing
exporters and shutdown/flush behavior. Run focused app tests if available, report the files
changed, and tell the developer what environment variables to set. Do not claim successful live
export until a real run confirms it.

The mapping input must already be sharded to one OTLP `traceId`. The ingest layer, not JSONata,
splits multi-call export batches before evaluation.

## Required evidence

For OTLP, inspect producer span code and use a completed-call capture when available. For JSON
logs, inspect the producer's serialization, write path, and correlation code; a repo fixture or
a code-derived completed-call sample may be used to validate locally. Label a code-derived
sample `source_derived` and do not describe it as a captured production log. Never use an old
`.pulse/` sample as proof of what the application currently produces.

Prefer captures covering a multi-turn call, interruption, tool call, and error. A happy-path trace
cannot prove those mappings. If the application emits no OTLP, a sufficiently structured JSON
log can still be mapped. Otherwise report the missing source facts and stop this mapping workflow.

Never read `.env` values, credentials, unrelated conversation content, or unrelated application
code. Report when source semantics and captured payloads disagree. Write mapping artifacts only
to `.pulse/artifacts/otlp/`; the sole allowed app-source change is an approved exporter setup.

**Stay local.** Everything you need is the producer repo plus this skill's `references/`. Do NOT use
web search, external documentation, or MCP servers, and do NOT read files outside the producer repo
and the artifact directory. If the producer's dialect is unfamiliar, infer it from *their* source and
sample traces — not from the internet.

## Load the contract

Before writing the mapping, read:

1. [references/canonical-trace.md](references/canonical-trace.md) for the exact output contract and
   correlation rules.
2. [references/metric-inputs.md](references/metric-inputs.md) for the signals behind each metric.
3. [references/jsonata-authoring.md](references/jsonata-authoring.md) for OTLP normalization and
   safe JSONata patterns.

Producer source defines meaning. Captured payloads confirm wire shape and units. Similar names are
not evidence of equivalent semantics.

## Workflow

1. Inventory the chosen source's call, turn, speech, STT, LLM, TTS, playout, and tool records,
   including relationships, status, units, and text fields. For OTLP inspect emitted spans and
   events; for JSON logs inspect the serialized records and their producer call sites.
2. Identify the call root or log record and prove how all records belonging to one call correlate.
3. Identify one caller-agent exchange and derive a stable `turn_id` for every related `turn`,
   `speech`, `stt`, `llm`, `tts`, and `playout` span. Canonical output requires explicit IDs even
   when input spans are nested.
4. Classify stages by semantics. Use `unknown` when evidence is insufficient.
5. Map canonical attributes and content. Convert canonical latency attributes to seconds and all
   output span/event times to seconds from call start.
6. Preserve useful raw names and unmapped attributes. Put conversation text in `content`.
7. **Validate in a loop, in this run.** Run `validate-trace-mapping` using the command in `.pulse/SETUP.md`,
   read its errors, fix `mapping.jsonata`, and run it again until it exits 0. Its dependencies
   are already installed. Do not run `npm install` or install anything.
8. For `json_log`, first confirm the storage findings and write the final
   `.pulse/artifacts/storage/storage-manifest.json` with the selected `kind: "log"`,
   `decoder: "json"` rule. Validation refuses a missing or different rule. Then run
   `register-trace-mapping` using the command in `.pulse/SETUP.md`. It repeats validation
   before registration. OTLP uses Pulse's existing mapping endpoint; `json_log` uses the planned
   `/v1/ingest/json-log-mapping` endpoint. A missing endpoint is a Pulse runtime blocker, not a
   reason to misregister JSON logs as OTLP. Report the actual command result.

## Pre-finish checklist (the validator enforces exactly these — check every one before writing)

These four are what fail most often. Verify each against the sample:

1. **Arrays, always.** `spans` is a non-empty array and every span's `events` is an array. JSONata
   returns a *single object* for a one-match path and *nothing* for zero — wrap sequences in `[ ]` so
   one match still yields an array and none yields `[]`. (Most common failure.)
2. **`turn_id` on every turn-stage span.** Each `turn`/`speech`/`stt`/`llm`/`tts`/`playout` span needs
   an explicit `turn_id`, and it must equal some `turn` span's id (the anchor). Nested inputs still need
   the id written onto every descendant — propagate it, don't rely on parent nesting.
3. **Times are seconds-from-call-start, as numbers.** Derive `t0` from the call root or proven log
   start; convert each input timestamp according to its actual unit. Never emit epoch values or raw
   nanoseconds for span/event offsets. Canonical latency attrs
   (`metrics.ttft`/`ttfb`/`e2e_latency`, `endpointing.delay`) are seconds, as numbers.
4. **Header strings + ISO timestamps.** `call_id`/`source`/`environment`/`started_at` are non-empty
   strings; `started_at`/`ended_at` are ISO-8601 strings (e.g. `$fromMillis(ns/1e6)`), not epoch numbers.

Also: every `span_id` is a unique non-empty string, `stage` is one of
`call|turn|speech|stt|llm|tts|playout|tool|net|unknown`, and `attrs`/`content` are objects (`{}` if empty).

## Non-negotiable rules

- One call produces one non-empty `header.call_id`; normally this is OTLP `traceId`.
- An OTLP mapping sample contains exactly one distinct non-empty `traceId`. A JSON-log sample
  needs one call's records with a producer-proven call ID; it need not have OTLP fields.
- `t_start`, `t_end`, and event `t` are seconds from call start, never epoch values.
- Every turn-stage span has an explicit `turn_id` in canonical output.
- `metrics.ttft`, `metrics.ttfb`, `metrics.e2e_latency`, and `endpointing.delay` use seconds.
- Map by meaning and stage. For example, producer `ttfb` on an LLM span may mean Pulse TTFT.
- Text belongs in `content.transcript`, `content.llm_raw`, or `content.llm_spoken`.
- Reported durations remain `metrics.*` attributes; do not present them as observed events.
- Unknown and missing are valid. Guessed values are invalid.
- Never use JSONata `$eval` on producer-controlled strings. Decode embedded JSON only through a
  trusted preprocessing helper.
- Never hard-code captured trace IDs, span IDs, timestamps, or content.

## Deliverables

Write these artifacts to `.pulse/artifacts/otlp/`:

- `mapping.jsonata`: final expression only.
- `mapping-source.json`: `{ "source_kind": "otlp" | "json_log", "sample_origin": "captured" |
  "source_derived", "storage_rule_id": "..." }`. `storage_rule_id` is required for `json_log` and
  must identify the confirmed storage rule for the selected log. For OTLP it may be omitted.
- `sample-otlp.json` for OTLP, or `sample-json-log.json` for JSON logs: the one-call source JSON
  validated against. A code-derived sample must be synthesized from source, not `.pulse/` history.
- `integration.json`: `{ "framework", "language", "use_case" }`. `use_case` is a short (<=120 char),
  generic downstream **market** use-case the agent serves (e.g. "outbound appointment reminders for
  clinics") — NO company/product/person names, NO code, NO PII; `"unknown"` if you can't tell.

Report producer evidence, the source key and rule ID for logs, sample provenance, tested
scenarios, and unavailable signals in the agent chat. Do not write a separate Markdown notes file.

(The CLI writes `canonical-trace.json` + `coverage.json` during validation.)
Storage rules belong to `pulse-storage-mapping`; cross-reference its selected log rule ID.

## Completion gate

A mapping is ready only when it is correct against the canonical contract for every sample: every
recognized turn-stage span is correlated with an explicit `turn_id`, every time unit is proven,
each mapped semantic cites evidence, and missing behavioral scenarios are disclosed. The CLI's
validator is the authority — produce deliverables that pass it.
