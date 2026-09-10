---
name: pulse-otlp-mapping
description: >-
  Use when onboarding a voice agent to Pulse whose OTLP dialect Pulse doesn't natively support.
  Guides writing ONE JSONata expression that converts the producer's OpenTelemetry payloads into
  Pulse's canonical Trace shape, so Pulse's fixed metric engine can compute the dashboard. Read the
  producer's source to learn what it emits, then map/derive it. Covers the canonical Trace schema and
  the closed attribute vocabulary the engine reads, stage and turn-grouping semantics, mapping tricks
  (map-by-meaning, stage-aware ttfb→ttft, expanding JSON-blob metrics, squeezing implied fields),
  JSONata idioms, and how to validate and classify the result (sorted / doable / impossible).
license: MIT
---

# Author a Pulse OTLP → canonical Trace mapping (JSONata)

> This is the wizard's brain. It is injected as context into whatever coding agent the developer
> uses (Claude Code / Codex / an ACP agent). Your job, agent, is to read the developer's voice-agent
> **source code** and produce **one JSONata expression** that converts their OpenTelemetry (OTLP)
> payloads into Pulse's **canonical Trace** JSON. Pulse then runs its own metric engine on that
> canonical shape — unchanged — to produce every number on the dashboard.
>
> **Draft — for review.** Field lists are grounded in Pulse's core; treat the canonical vocabulary
> and Trace schema as authoritative, the prose as refinable.

---

## 1. The pipeline you are one step of

```
producer OTLP  ──[ YOUR JSONata expression ]──▶  canonical Trace  ──[ Pulse metric engine ]──▶  UI metrics
```

- The metric engine is fixed. It reads a **closed canonical vocabulary** (Section 4) off a fixed
  **Trace shape** (Section 3). It does not know or care which producer the data came from.
- Therefore **the only lever on how good the dashboard looks is the quality of your mapping.** Every
  metric you can light up is a metric you *mapped or derived* into canonical form.
- You are not editing the producer's telemetry. You are writing a pure transform: OTLP JSON in,
  canonical Trace JSON out.

## 2. Your deliverable

A single JSONata expression string that, given one OTLP `ExportTraceServiceRequest` payload
(`{ resourceSpans: [...] }`), evaluates to:

```json
{ "header": { ... }, "spans": [ ... ] }
```

matching the schema in Section 3. Nothing else. It must be **total**: it should work for every call
the producer emits, not just the sample you're looking at (missing fields → simply absent, never an
error — see Section 10).

## 3. The canonical Trace schema (the exact target)

```jsonc
{
  "header": {
    "call_id": "string",            // REQUIRED, non-empty. One call = one trace; use the traceId.
    "source": "string",             // producer/service name (resource service.name)
    "environment": "string",        // e.g. "prod"; default "prod" if absent
    "started_at": "ISO-8601",       // call start as an ISO datetime string
    "ended_at": "ISO-8601 | null",  // call end
    // optional rollups (fill if cheaply known, else omit): engine, carrier,
    // stt_provider, llm_provider, llm_model, tts_provider, voice, template_sha256
  },
  "spans": [
    {
      "span_id": "string",
      "parent_span_id": "string | null",
      "name": "string",             // the producer's raw span name (keep it)
      "stage": "call|turn|speech|stt|llm|tts|playout|tool|net|unknown",  // Section 5
      "t_start": 0.0,               // SECONDS since call start (float), NOT nanoseconds
      "t_end": 0.0,                 // SECONDS since call start (float), or null
      "turn_id": "string | null",   // groups a turn's spans; Section 5
      "error": false,
      "attrs": { },                 // canonical attributes; Section 4
      "content": { },               // conversation text; Section 8
      "events": [ { "name": "string", "t": 0.0, "attrs": {}, "content": {} } ]
    }
  ]
}
```

Critical shape rules (common mistakes):
- **Times are seconds-from-call-start**, as floats — not epoch nanoseconds. Compute
  `t0 = start of the root span (ns)`, then every span's `t_start = (span_start_ns - t0) / 1e9`.
- **Header timestamps are ISO strings**, not numbers. Convert epoch → ISO (e.g. `$fromMillis(ns/1e6)`).
- `call_id` must be a non-empty string. Use the `traceId` unless the producer groups calls another way.
- Unknown attributes are allowed but ignored by the engine — only the canonical names in Section 4 are
  read. Put shape data in `attrs`, conversation text in `content`.

## 4. The canonical vocabulary (what the engine actually reads)

Map the producer's attributes onto these exact keys. Anything not on this list is dead weight to the
metric engine (it's kept but unread). **Units matter: all `metrics.*` latencies and `endpointing.delay`
are in SECONDS.**

| Canonical attr (on `attrs`) | Meaning | Stage it belongs on |
|---|---|---|
| `turn.id` | turn correlation id | turn + its children |
| `turn.index` | 1-based turn number (ordering) | turn |
| `turn.trigger` | what started the turn | turn |
| `turn.interrupted` | caller barged in | turn |
| `turn.interruption_probability` | barge-in confidence | turn |
| `turn.committed` | turn was committed | turn |
| `turn.abandoned` | turn abandoned | turn |
| `stt.language` | detected language | stt |
| `stt.confidence` | transcription confidence | stt |
| `llm.finish_reason` | why generation stopped | llm |
| `metrics.ttft` | time to first token (**seconds**) | llm |
| `metrics.ttfb` | time to first audio byte (**seconds**) | tts |
| `metrics.e2e_latency` | producer's own end-to-end (**seconds**) | turn |
| `endpointing.delay` | endpointing hold after speech (**seconds**) | turn/stt |
| `gen_ai.usage.input_tokens` | prompt tokens | llm |
| `gen_ai.usage.output_tokens` | completion tokens | llm |
| `gen_ai.usage.cached_tokens` | cached prompt tokens | llm |
| `gen_ai.request.model` | model name | llm/tts |
| `tts.chars` | characters synthesized | tts |
| `tts.chars_cut` | characters cut on interruption | tts |
| `tts.cut_reason` | why TTS was cut | tts |
| `tts.cancelled` | synthesis aborted | tts |

Span **events** the engine reads (on `events[].name`) — an alternative source for the same latencies
when the producer emits them as events rather than attributes:
- `llm.first_token` → feeds TTFT (if `metrics.ttft` attr absent)
- `tts.first_audio` → feeds TTFB (if `metrics.ttfb` attr absent)

## 5. Stages and turn grouping (the structural core)

`stage` classifies each span; the engine's timing logic keys entirely off it.

| Stage | Meaning | Why it matters for metrics |
|---|---|---|
| `call` | the whole session / root | carries call_id, timestamps |
| `turn` | one exchange (caller ↔ agent) | the unit every turn metric is computed on |
| `speech` | caller audibly speaking (VAD) | its **end = end of caller speech** → response-latency start |
| `stt` | transcription | transcript, language, confidence; STT-final timing |
| `llm` | generation | tokens, TTFT |
| `tts` | synthesis | chars, TTFB, agent-speaking window |
| `playout` | audio reaching the caller | agent-speaking window |
| `tool` | tool/function call | — |
| `unknown` | unmapped | never guess — leave `unknown` if unsure |

Turn grouping:
- A **turn** span (stage `turn`) anchors one exchange. Its `stt`/`llm`/`tts` spans must carry the same
  `turn_id` (or be nested under the turn span so the engine can attach them).
- If the producer nests service spans **under** the turn span (Pipecat-style), just set each turn
  span's `turn_id` to its own id; children inherit it structurally. If service spans are **siblings**
  with a shared correlation attribute, map that attribute to `turn.id` on all of them.
- If the producer splits one exchange into two turn spans (LiveKit's `user_turn` + `agent_turn`), give
  the agent-side span the **preceding caller turn's** id, so both halves land in one exchange.

## 6. What feeds which UI metric (so you know what to chase)

The engine derives these from what you map. Prioritize mapping the inputs on the right.

| UI metric | Needs (canonical) |
|---|---|
| response latency | `speech` span end + `tts` start (span timings) |
| STT lag | `speech`/`stt` timings |
| **TTFT** | `metrics.ttft` **or** an `llm.first_token` event **or** first-token latency the producer records under another name (see Section 7) |
| TTFB | `metrics.ttfb` **or** a `tts.first_audio` event |
| tokens in/out/cached | `gen_ai.usage.*` |
| TTS chars | `tts.chars` |
| language / confidence | `stt.language` / `stt.confidence` |
| interruptions | `turn.interrupted`, `tts.chars_cut`, `tts.cut_reason` |
| transcript / agent text | `content.transcript` / `content.llm_spoken` |

## 7. The mapping playbook (the tricks that separate a good mapping from a lazy one)

1. **Map by meaning, not by name.** The producer may record a canonical quantity under a different
   name. Example: some producers label the LLM's first-token latency `metrics.ttfb` *on the LLM span*
   — that value **is** TTFT. Promote it (stage-aware) to `metrics.ttft`. Don't leave a metric dashed
   just because the name didn't match.
2. **Be stage-aware.** The same source key can mean different things on different spans (`ttfb` on
   `llm` = TTFT; `ttfb` on `tts` = TTFB). Branch on the span's stage.
3. **Expand embedded blobs.** If the producer packs metrics into a JSON *string* attribute, parse it
   (`$eval`) and spread the fields into canonical attrs.
4. **Squeeze implied fields.** Cached tokens under `cache_read.input_tokens` → `gen_ai.usage.cached_tokens`.
   A model name buried in metadata → `gen_ai.request.model`. Look for everything the engine can use.
5. **Content vs shape.** Transcripts / spoken text go in `content` (Section 8), everything else in `attrs`.
6. **Watch units.** Canonical latencies are **seconds**. If the producer emits milliseconds, divide.
7. **Never fabricate.** If the producer genuinely doesn't emit something (e.g. STT confidence,
   endpointing), leave it out. A dashed metric is honest; a wrong one is not.

## 8. Content

Conversation text lives in `span.content`, keyed by kind:
- `transcript` — the caller's transcribed speech (on the `stt` span, or a turn span).
- `llm_spoken` — what the agent said / the LLM's spoken output (on the `tts` span).
- `llm_raw` — raw model output, if distinct from spoken.

Producers that already namespace text under `voice.content.*` map cleanly; producers that put it in a
plain attribute (`transcript`, `text`) should be routed into `content` by your expression.

## 9. JSONata cookbook (idioms you'll need)

- **Flatten OTLP typed attributes** (`{key, value:{stringValue|intValue|boolValue|doubleValue}}`):
  a helper that reads whichever value field is present and merges the list into an object.
- **ns → seconds:** `$round(($number(startNs) - $t0) / 1e9, 6)`.
- **epoch → ISO:** `$fromMillis($number(ns) / 1e6)`.
- **root span:** the one with no `parentSpanId`; its start is `$t0`.
- **merge objects / build conditionally:** `$merge([...])` of per-field `cond ? {k:v} : {}`.
- **parse an embedded JSON string:** `$eval(theString)` (JSON is a subset of JSONata).
- **nearest-turn ancestor:** walk `parentSpanId` via a `{spanId: span}` map to find the enclosing
  `turn` span; a turn span's `turn_id` is its own id.
- **quote dotted keys** with backticks: `` $f.`gen_ai.usage.input_tokens` ``.

## 10. Honesty & degradation

- The metric engine degrades gracefully: a canonical field that's absent renders as `-` on the UI and
  the rest of the call still computes. So **omit** what the producer doesn't provide — do not invent.
- Classify every canonical field into one of three buckets and report them:
  - **sorted** — mapped and verified against the sample output.
  - **doable** — present in the producer's spans but not yet mapped → map it.
  - **impossible** — the producer never emits it → leave dashed; note it so the developer can improve
    their telemetry if they want that metric.

## 11. The process you follow

1. **Read the producer's source** — find where it creates spans / sets attributes / emits events. This
   is the ground truth for what's available and what each field means (better than a sample alone).
2. **Look at sample spans** (provided) to confirm exact key names and value encodings.
3. **Draft** the JSONata expression targeting the Section 3 shape and Section 4 vocab.
4. **Run it locally** on the samples (the wizard does this) and **diff** the produced canonical Trace
   against expectations; fix until valid.
5. **Classify** remaining gaps (sorted / doable / impossible) and squeeze every *doable* one.
6. **Hand back** the final expression; the wizard registers it with Pulse.

## 12. Worked shape (Pipecat, abbreviated)

Producer: `conversation` (root) → `turn` → `stt`/`llm`/`tts` children; emits `gen_ai.usage.*`,
`metrics.ttfb`, `turn.number`, `transcript`, `text`.

Mapping decisions:
- stages: conversation→`call`, turn→`turn`, stt→`stt`, llm→`llm`, tts→`tts`.
- `turn.number`→`turn.index`; `turn.was_interrupted`→`turn.interrupted`; `language`→`stt.language`;
  `metrics.character_count`→`tts.chars`; `gen_ai.usage.cache_read.input_tokens`→`gen_ai.usage.cached_tokens`.
- **stage-aware:** `metrics.ttfb` on the `llm` span → `metrics.ttft` (first-token latency); on `tts` it
  stays `metrics.ttfb`.
- content: `transcript`→`content.transcript`; `text`→`content.llm_spoken`.
- `gen_ai.usage.input_tokens` / `output_tokens` / `metrics.ttfb`(tts) / `gen_ai.request.model` are
  already canonical → pass through.

Result: the full latency waterfall (response latency, STT lag, **TTFT**, TTFB, assembly/dispatch),
tokens (in/out/cached), chars, language, and transcripts all light up. Genuinely absent (dashed):
STT confidence and endpointing delay — Pipecat doesn't emit them.
