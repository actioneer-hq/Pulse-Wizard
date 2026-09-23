# Integration artifacts

Write exactly:

```text
.pulse/artifacts/integration/
  mapping-plan.json
  manifest.json
  fixtures/<source-id>/<case-id>.json
```

The validator creates `coverage.json`. Do not write `evidence.json`, generated output files, or
Markdown notes.

## Mapping plan

`mapping-plan.json` uses schema `pulse.mapping-plan`, version `1`:

```jsonc
{
  "schema": "pulse.mapping-plan",
  "version": 1,
  "requirements": {
    "TranscriptTurn.text": {"status":"mapped", "sources":["conversation"]},
    "Span.error": {"status":"unavailable", "reason":"No producer emits an error flag."}
  },
  "sources": [{
    "id": "conversation",
    "producer": {"file":"src/writer.py", "symbol":"write_conversation"},
    "artifact_ids": ["conversation-object"],
    "mapper_ids": ["conversation-transcript", "conversation-trace"],
    "format": {
      "decoder": "text",
      "cardinality": "one",
      "description": "<what the writer serializes, in its own terms>",
      "variants": [{
        "id": "<writer branch that changes the serialization>",
        "description": "<the code-proven rule for this variant>",
        "cases": ["<case ids covering it>"]
      }],
      "projections": [{
        "id": "turn-text",
        "locator": "<where in the serialization these fields live>",
        "canonical_fields": ["TranscriptTurn.speaker", "TranscriptTurn.text", "TranscriptTurn.sequence"],
        "via": {"mapper":"conversation-transcript"},
        "use": "selected"
      }]
    },
    "path_cases": [
      {"artifact_id":"conversation-object", "object_path":"calls/c1/conversation.md", "matches":true, "call_id":"c1"},
      {"artifact_id":"conversation-object", "object_path":"calls/conversation.md", "matches":false}
    ]
  }],
  "overlaps": []
}
```

Use `via.artifact` for audio properties supplied by an audio artifact rule. A duplicate candidate
that was not selected uses `use: duplicate_not_selected` and `via: {"unmapped":true}`. Record the
decision in `overlaps` with its canonical fields, all candidates, selected source, and
`confirmed: true`.

Do not create overlap decisions for canonical `*.call_id` fields. They are join keys and may list
multiple selected sources in `requirements`; all other duplicated fields require exactly one
confirmed primary source.

Every selected artifact needs positive and negative path cases. ZIP/TAR cases include
`member_path`. Multi-call sources use `cardinality: many`, artifact correlation `from: mapper`, and
mapper outputs are arrays of canonical fragments.

## Manifest

Use schema `pulse.integration`, version `1`. Preserve provider-native connections and normalized
credential labels without values. Each mapper declares:

```json
{
  "language": "jsonata",
  "input": "otlp|json|records|text",
  "output": "call|trace|transcript",
  "cardinality": "one|many",
  "expression": "..."
}
```

There is no measurements output: producer-reported numbers (TTFT, tokens, chars) ride the relevant
span as attrs from the contract's `span_attr_vocabulary`, already converted to canonical units.

Keep `expected_capabilities` empty; validation derives it (evidence only — which spans/transcript/
audio/attrs exist — never which metrics Pulse will compute). Audio emissions use `mono`, `stereo`,
or `dual_mono`. Include `channel_map` only with source-proven speaker assignments; omit it when
unknown — Pulse detects speakers and trust-notes the detection. Never assume channel zero is the
caller.

## Unit evidence

Every projection whose `canonical_fields` include a time field (`Span.t_start`, `Span.t_end`,
`SpanEvent.t`, `TranscriptTurn.t_start/t_end`, `CallHeader.started_at/ended_at`,
`AudioRef.t0_offset_s`) must carry `unit_evidence` citing the producer code that writes the
number:

```json
{"source_api": "time.monotonic()", "file": "src/pipeline.py", "line": 118, "source_unit": "s"}
```

`source_unit` is one of `s | ms | ns | epoch_s | epoch_ms | iso`; the JSONata expression performs
the conversion to canonical seconds-from-t0.

## Untimed sources

A conversation file with no timestamps maps to a transcript whose turns carry `sequence` (line
order) and no times:

```json
{
  "language": "jsonata",
  "input": "text",
  "output": "transcript",
  "cardinality": "one",
  "expression": "{\"call_id\": _pulse.call_id, \"turns\": [$map($split(data.text, \"\\n\"), function($line, $i) { {\"speaker\": $substringBefore($line, \": \") = \"user\" ? \"caller\" : \"agent\", \"text\": $substringAfter($line, \": \"), \"sequence\": $i} })]}"
}
```

Untimed spans follow the same rule: `t_start: null` plus `sequence`. Never invent a timestamp.
