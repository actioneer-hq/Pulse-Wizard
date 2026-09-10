# Canonical Trace contract

The JSONata result must match this shape. Header optionals may be omitted. Span fields are required
even when their value is `null`.

```jsonc
{
  "header": {
    "call_id": "string",
    "source": "string",
    "environment": "string",
    "started_at": "ISO-8601 timestamp",
    "ended_at": "ISO-8601 timestamp | null",
    "engine": "string | null",
    "carrier": "string | null",
    "stt_provider": "string | null",
    "llm_provider": "string | null",
    "llm_model": "string | null",
    "tts_provider": "string | null",
    "voice": "string | null",
    "template_sha256": "string | null",
    "labels": {},
    "counters": { "span_dropped_events": 0 }
  },
  "spans": [{
    "span_id": "string",
    "parent_span_id": "string | null",
    "name": "raw producer span name",
    "stage": "call|turn|speech|stt|llm|tts|playout|tool|net|unknown",
    "t_start": 0.0,
    "t_end": "number | null",
    "turn_id": "string | null",
    "error": false,
    "attrs": {},
    "content": {},
    "events": [{ "name": "string", "t": 0.0, "attrs": {}, "content": {} }]
  }]
}
```

## Stages

| Stage | Meaning |
|---|---|
| `call` | Session/call lifecycle, normally including the root. |
| `turn` | One caller-to-agent exchange, including an opening agent-only turn. |
| `speech` | Caller speech window; its end anchors end-of-speech. |
| `stt` | Recognition/transcription work. |
| `llm` | Model generation work. |
| `tts` | Speech synthesis work. |
| `playout` | Synthesized audio delivered or played to the caller. |
| `tool` | Tool or function execution. |
| `net` | Explicitly known network/transport work. |
| `unknown` | Insufficient evidence to classify. |

Do not classify wrappers as a voice stage merely because they contain that stage as a child.

## Turn correlation

Pulse groups spans by canonical `turn_id`, not `parent_span_id`. Every `turn`, `speech`, `stt`,
`llm`, `tts`, and `playout` span in an exchange must carry the same explicit `turn_id`.

- Nested input: derive the nearest turn ancestor and write its ID onto each descendant.
- Shared attribute: normalize it and write it onto all related spans.
- Split caller/agent turns: prefer explicit correlation. Pair temporally only when source proves that
  ordering is stable.
- Opening turn: assign one shared ID and set `turn.trigger` to `opening`.

Never correlate solely by array position; OTLP batching and retries may reorder spans.

## Attributes read by Pulse

| Key | Type/unit | Stage |
|---|---|---|
| `turn.index` | integer | turn |
| `turn.trigger` | `opening` or `endpoint` | turn |
| `turn.interrupted` | boolean | turn |
| `turn.interruption_probability` | number | turn |
| `turn.abandoned` | boolean | turn |
| `stt.language` | string | stt |
| `stt.confidence` | number | stt or turn |
| `llm.finish_reason` | string | llm |
| `metrics.ttft` | seconds | llm |
| `metrics.ttfb` | seconds | tts |
| `metrics.e2e_latency` | seconds | turn |
| `endpointing.delay` | seconds | turn |
| `gen_ai.usage.input_tokens` | integer | llm |
| `gen_ai.usage.output_tokens` | integer | llm |
| `gen_ai.usage.cached_tokens` | integer | llm |
| `gen_ai.request.model` | string | stt, llm, or tts |
| `tts.chars` | integer | tts |
| `tts.chars_cut` | integer | tts |
| `tts.cut_reason` | `barge_in` or `hangup` | tts |
| `tts.cancelled` | boolean | tts |

`turn.id` may remain in `attrs`, but grouping uses the top-level `turn_id` field.

## Events read by Pulse

| Event | Meaning |
|---|---|
| `llm.first_token` | Observed first generated token. |
| `tts.first_audio` | Observed first synthesized audio. |
| `turn.committed` | Observed turn commit. |
| `bargein` | Producer-observed barge-in, compared with audio analysis. |
| `exception` | Marks the containing span as errored. |

For an event on a call-scoped span, put its target `turn.id` in event `attrs`.

## Content

| Key | Meaning |
|---|---|
| `transcript` | Caller transcript. |
| `llm_raw` | Raw model output when different from spoken output. |
| `llm_spoken` | Text synthesized or spoken by the agent. |

Keep content out of `attrs`. Lists are allowed for segmented content.

## Time and errors

- Set `t0` from the call root's start nanoseconds.
- Span/event relative time is `(timestamp_ns - t0) / 1e9`.
- Header timestamps are UTC ISO-8601 values derived from epoch nanoseconds.
- Set `error=true` for OTel status `ERROR`, `error.type`, or an `exception` event.

