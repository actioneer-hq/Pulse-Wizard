---
name: pulse-integration-mapping
description: Connect a voice-agent repository to Pulse by tracing Pulse's canonical Trace, Audio, and Transcript requirements backward to source-produced telemetry and stored artifacts, then declaring and validating exact formats and mappers.
license: MIT
---

# Connect a voice agent to Pulse

Work backward from `.pulse/contracts/canonical.json`. The goal is not to classify familiar files;
it is to find the application-produced atomic facts that can populate Pulse's canonical models.
`.pulse/` is ignored Wizard state, never evidence about application behavior.

The one idea everything else follows from: **Pulse is programmatic — it consumes only the
structured canonical model — while a producer's output can be literally anything: markdown, free
text, JSONL, CSV, a bespoke log grammar, a format with no name.** That mismatch is the entire job.
Every stored artifact was written by code, so its structure is deterministic even when its format
is unrecognizable: the writer IS the grammar, and the code base is the source of truth for it.
Never reason from file type or resemblance to a known format — read the writer, recover the exact
structure it guarantees (delimiters, escaping, ordering, optional sections, invariants), and
express the extraction as a mapper into the canonical shape. A format you have never seen is not
an obstacle; it is the normal case.

Before mapping anything, classify **how** this producer's telemetry reaches Pulse — the manifest's
required `ingest_method`, and the first thing to settle because it decides what the rest of the work
even is:

- `telemetry_ingest_event` — the app emits OTLP spans live (an exporter is wired, or trivially can
  be). Pulse receives the push; the manifest carries the OTLP-to-trace mapper, not stored artifacts.
- `storage_polling` — the app persists telemetry to a store (blob, DB, logs) with no live exporter.
  Pulse can only poll it; the manifest carries the storage connections, selectors, and mappers that
  turn those artifacts into the canonical model. This is the default when facts live at rest.
- `not_applicable_no_logs` — the app records no usable telemetry anywhere. There is nothing to map;
  say so plainly and direct the developer to add telemetry first, rather than inventing a mapping.

Decide this from what the code actually does (does it export, or persist, or neither?), not from
what would be convenient. The value must agree with the manifest: pull carries artifacts, push
carries a ready OTLP mapper and none, "no logs" carries neither.

Read [references/artifacts.md](references/artifacts.md) before writing integration artifacts and
[references/validation.md](references/validation.md) before creating cases or running validation.

## 1. Find canonical sources

Create a checklist for every field in the installed Trace, Audio, and Transcript models. For each
field, trace backward through the entire application flow: runtime values, configuration,
constants, control flow, serializers, exporters, storage calls, key builders, archives, feature
flags, and call sites. The repository's execution semantics are the source of truth. Stored
artifacts are transport inputs to Pulse, not the sole source of meaning.

- A source is atomic when it stores or emits an original application fact. The test is
  provenance, not kind: anything the application deterministically recorded about what happened
  during the call is evidence — what was said, but equally what the agent DID and DECIDED
  (actions it invoked with their arguments and results, routing and language decisions,
  interruptions, corrections, drops). Speech has no privileged status; a recorded action is as
  atomic as a recorded sentence, and analysis downstream needs both. Map each fact to the
  canonical shape its nature dictates: an operation with duration → a span of the matching
  stage; an instant → an event; dialogue → transcript turns; sound → audio. Provider-reported
  numbers (TTFT, token counts, characters) ride the relevant span as attrs from the contract's
  `span_attr_vocabulary` — never a separate measurements payload. The only exclusions are
  quantities DERIVED from other recorded facts (latencies Pulse can compute, ratios,
  percentiles, rollups): map the underlying facts instead.
- Names are normalized, meanings are preserved. Producers name their stages, events, and
  reported numbers idiosyncratically; the mapper's job is to carry each fact under its
  canonical name (stage enum, `span_attr_vocabulary`, and conventional event names such as
  `stt.final`, `turn.committed`, `llm.first_token`, `tts.first_audio`, `bargein`) whenever the
  source's meaning matches, so Pulse's derivations recognize the fact regardless of who
  produced it. Never rename a fact whose meaning differs — an unknown name passed through
  honestly beats a familiar name applied wrongly.
- Atomicity is section-level. One Markdown or text file may contain transcript turns, trace events,
  tool activity, prompts, and irrelevant summaries. Evaluate every deterministic section.
- Format and extension do not affect relevance. JSON, JSONL, CSV, text, Markdown, archives, and
  extensionless objects are valid when writer code defines their structure.
- A canonical field need not appear explicitly in a stored artifact or telemetry payload. It may
  come from a serialized value, a code-proven invariant, or a deterministic combination of
  runtime data and repository knowledge. Encode proven constants and transformations in the
  mapping rather than waiting for the producer to serialize an already-canonical shape.
- Follow values across boundaries. Recover semantics from deterministic structure such as
  composite values, object keys, paths, naming rules, branch selection, constructor arguments,
  and writer logic. Do not equate "not stored as its own field" with "unavailable".
- Mark a field `unavailable` only after tracing its full production path and proving that neither
  runtime input nor stable repository evidence can determine it. If deployment configuration can
  select among multiple values and code cannot identify the active one, ask the developer instead
  of guessing.
- Exclude derived summaries, classifications, RCA output, dashboards, and cached analysis.
- Do not require bucket access, real samples, credentials, or a live call. Application code is the
  source of truth.

Ask only when code cannot decide a deployment fact: active provider/layout, optional producer or
archiver, or speaker assignment. Use short selectable questions. If multiple valid sources provide
the same canonical fields, show the source choices and ask which one should be primary. Select one
source only for overlapping fields; preserve unique fields from every source. Canonical `call_id`
fields are correlation keys, not competing evidence: allow the same call ID from every applicable
source so Pulse can join partial fragments. Never ask the developer to choose a `call_id` source.
Never ask the developer to design regexes, formats, mappers, canonical coverage, or credential
mappings.

## 1a. Null evidence — never invent

Evidence fields are nullable; identity fields are not. Null means the producer never had the fact.

- Never fabricate a timestamp, duration, speaker, or channel assignment. If the source has no
  clock, emit `t_start: null` and carry `sequence` (source order) instead — an untimed span or
  transcript turn must have `sequence`, because line order is then the only order.
- A dialogue source with no timestamps — whatever its format — is fully mappable: one transcript
  turn per dialogue unit, `sequence` = source order, no times. Pulse still runs transcript, judge,
  and clustering; only timing metrics read honestly absent.
- Identity (`call_id`, `span_id`) is minted deterministically by the mapper when the producer has
  none (filename, directory, hash). Synthetic identity is bookkeeping, not evidence.
- A span must assert at least one fact (stage, time, content, attrs, or an event). If a section
  yields nothing, emit nothing — no null husks.
- Audio: emit only what the source proves. `channel_map` is included only with source evidence for
  the speaker assignment; when unknown, omit it — Pulse detects speakers and notes it in the trust
  report. Never assume channel zero is the caller.

## 1b. Units — prove, convert, cite

Canonical units are fixed and carry no unit fields: relative times are seconds from call t0,
absolute times ISO-8601, durations seconds. Every source uses whatever its code uses — so for
every time or duration you map:

1. Find the producer line that WRITES the number and identify its unit from the API used:
   `time.time()` / `Date.now()/1000` epoch seconds; `Date.now()`, `performance.now()`
   milliseconds; `process.hrtime.bigint()`, OTLP `startTimeUnixNano` nanoseconds;
   `perf_counter()` deltas seconds.
2. Encode the conversion in the JSONata expression itself — `ms / 1000`,
   `(ns - t0_ns) / 1e9`, epoch minus call t0.
3. Record the proof as `unit_evidence` on the projection in `mapping-plan.json`
   (`source_api`, `file`, `line`, `source_unit`). Validation requires it for time fields.
4. Magnitude eyeballing ("looks like ms") is never proof. If the writing code cannot be found,
   this is one of the few legitimate developer questions — ask, do not guess.

Fixture cases must copy REAL sample values from the producer (never round inventions like `1.0`),
so a wrong conversion fails the expected-output comparison instead of sliding through. The
validator also rejects relative times of epoch/millisecond magnitude.

## 2. Declare formats, then map

Write `.pulse/artifacts/integration/mapping-plan.json` before `manifest.json` or any mapper. It must:

- account for every canonical field as `mapped`, `runtime_derived`, `unavailable`, `inactive`, or
  `unsupported`;
- describe every selected producer, exact serialization, cardinality, variants, storage paths,
  canonical projections, and code location;
- record unselected duplicate candidates and the confirmed primary-source decision;
- distinguish one-call objects from multi-call records or archives.

Only after the plan is complete, write the manifest and JSONata mappers. Derive selectors from
bucket-relative key builders, never repository paths. One artifact may emit multiple canonical
fragments. Parse deterministic free text completely, including escaping and variable delimiters.
Use `_pulse.call_id` for single-call path correlation; multi-call mappers derive each call ID from
the producer records.

## 3. Prove the mapping

Create exact cases for every declared format variant and material parsing branch. Include normal
and adversarial values for escaping, variable delimiters, optional sections, single/multiple
records, and archive members where applicable. The agent writes both inputs and expected canonical
outputs from producer code; validation never invents expected output.

Run `validate-integration` from `.pulse/SETUP.md` until it exits zero, then run
`register-integration`. Registration is forbidden while a canonical field, source choice, format
variant, selector example, or expected mapper result is unresolved. Do not claim registration
proved live bucket access.

Never read or print `.pulse/config.json`, write credentials, or add review notes under
`.pulse/artifacts/`.
