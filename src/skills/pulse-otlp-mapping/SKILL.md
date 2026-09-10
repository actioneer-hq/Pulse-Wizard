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
7. Evaluate against every sample and run:

   ```bash
   node <skill-dir>/scripts/validate-mapping.mjs \
     <artifact-dir>/mapping.jsonata <sample-otlp.json> \
     <artifact-dir>/canonical-trace.json <artifact-dir>/coverage.json
   ```

   The wizard supplies absolute values for `<skill-dir>` and `<artifact-dir>` when invoking the
   agent. Do not guess either path.

8. Fix every validation error. Review warnings and metric coverage against producer source.
9. Register only after validation passes.

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
- `coverage.json`: validator output with available, degraded, unavailable, and untested inputs.
- `mapping-notes.md`: concise evidence for mappings, tested scenarios, and unavailable signals.

Do not produce storage configuration here. That belongs to `pulse-storage-mapping`.

## Completion gate

A mapping is ready only when all samples validate without errors, every recognized turn-stage span
is correlated, every time unit is proven, each mapped semantic cites evidence, missing behavioral
scenarios are disclosed, and the coverage report matches what the traces honestly support.
