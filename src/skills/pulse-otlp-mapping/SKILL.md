---
name: pulse-otlp-mapping
description: >-
  Onboard an unsupported voice-agent OTLP dialect to Pulse by inspecting its source and captured
  traces, authoring a JSONata transform into Pulse's canonical Trace contract, and validating
  metric coverage before registration. Use for OTLP mapping only; use pulse-storage-mapping for
  recordings or archived traces in blob storage.
license: MIT
---

# Map voice-agent OTLP into Pulse

Produce one total JSONata expression that transforms an OTLP `ExportTraceServiceRequest` into
Pulse's canonical `Trace`. Pulse's metric engine stays fixed. The mapping supplies structure and
canonical meaning without inventing unavailable signals.

The mapping input must already be sharded to one OTLP `traceId`. The ingest layer, not JSONata,
splits multi-call export batches before evaluation.

## Required evidence

Do not author a mapping until both are available:

- Producer source that creates spans, attributes, events, or tracing configuration.
- At least one captured OTLP payload from a completed call.

Prefer captures covering a multi-turn call, interruption, tool call, and error. A happy-path trace
cannot prove those mappings. If the application emits no OTLP yet, stop this workflow and instrument
it to emit Pulse's canonical OTLP contract instead.

Never read `.env` values, credentials, unrelated conversation content, or unrelated application
code. Report when source semantics and captured payloads disagree. Write generated artifacts only
to the artifact directory supplied by the wizard; do not add mapping files to the customer's repo.

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

1. Inventory emitted span names, parent relationships, attributes, events, status values, units,
   and text fields relevant to calls, turns, speech, STT, LLM, TTS, playout, and tools.
2. Identify the call root and how all spans belonging to one call are correlated.
3. Identify one caller-agent exchange and derive a stable `turn_id` for every related `turn`,
   `speech`, `stt`, `llm`, `tts`, and `playout` span. Canonical output requires explicit IDs even
   when input spans are nested.
4. Classify stages by semantics. Use `unknown` when evidence is insufficient.
5. Map canonical attributes and content. Convert canonical latency attributes to seconds and all
   span/event times to seconds from root start.
6. Preserve raw span names and useful unmapped attributes. Put conversation text in `content`.
7. Mentally check the mapping against the canonical contract and every sample: valid stages, explicit
   `turn_id` on every turn-stage span, seconds-from-start times, canonical attribute names/units, and
   content in the right place. The **wizard** runs `scripts/validate-mapping.mjs` on your output and
   rejects it if anything is wrong — so make the deliverables correct; you do not run the validator.

## Non-negotiable rules

- One call produces one non-empty `header.call_id`; normally this is OTLP `traceId`.
- A mapping sample contains exactly one distinct non-empty OTLP `traceId`.
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

Return these artifacts to the wizard:

- `mapping.jsonata`: final expression only.
- `sample-otlp.json`: the single representative producer OTLP payload you validated against (so the
  wizard can re-validate the mapping independently).
- `integration.json`: `{ "framework", "language", "use_case" }`. `use_case` is a short (<=120 char),
  generic downstream **market** use-case the agent serves (e.g. "outbound appointment reminders for
  clinics") — NO company/product/person names, NO code, NO PII; `"unknown"` if you can't tell.
- `mapping-notes.md`: concise evidence for mappings, tested scenarios, and unavailable signals.

(The wizard runs the validator and writes `canonical-trace.json` + `coverage.json` itself — you don't.)
Do not produce storage configuration here. That belongs to `pulse-storage-mapping`.

## Completion gate

A mapping is ready only when it is correct against the canonical contract for every sample: every
recognized turn-stage span is correlated with an explicit `turn_id`, every time unit is proven,
each mapped semantic cites evidence, and missing behavioral scenarios are disclosed. The wizard's
validator is the authority — produce deliverables that pass it.
