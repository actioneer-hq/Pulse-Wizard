# Validation cases

Each declared case is one JSON file:

```jsonc
{
  "schema": "pulse.mapping-case",
  "version": 1,
  "source": "conversation",
  "variant": "<variant id from the plan>",
  "input": {
    "_pulse": {
      "call_id": "synthetic-call",
      "object_path": "calls/synthetic-call/conversation.md",
      "member_path": null
    },
    "data": {"text":"source-derived serialized content"}
  },
  "expected": {
    "conversation-transcript": {
      "call_id": "synthetic-call",
      "turns": [{"speaker":"caller", "text":"complete expected text", "sequence": 0}]
    }
  }
}
```

Expected keys must exactly match the source's mapper IDs. For `cardinality: many`, `_pulse.call_id`
is null and every expected mapper output is a nonempty array whose call IDs come from source data.
Audio-only sources use an empty `expected` object; path and audio configuration validate them.

Cases must exercise every format variant and every branch that changes parsing or canonical
output. Text cases must preserve sentinel content exactly so truncation is visible. Include dynamic
delimiters, delimiter-like content, embedded headings, empty optional sections, and one-versus-many
records when the writer supports them.

Time values in fixtures must be REAL sample values copied from the producer (a log line, a stored
file, a code default) — never round inventions like `1.0` or `1000`. Deep-equality against real
values is what catches a missing `/1000` in the mapper; invented values hide it.

Validation checks:

- every canonical field has a decision;
- selected projections appear in validated canonical output;
- duplicated non-identity fields have one user-confirmed primary source; `*.call_id` may come from
  every source it joins;
- producer files exist outside `.pulse/`;
- selectors pass positive/negative examples and extract the expected call ID;
- mapper output exactly equals the expected output and passes canonical model validation;
- relative times are canonical seconds: values of epoch/millisecond magnitude are rejected;
- an untimed span or transcript turn (no `t_start`) must carry `sequence`;
- a span must assert at least one fact — null husks are rejected;
- projections mapping time fields must carry `unit_evidence`;
- single-call mappers propagate `_pulse.call_id` and cannot hardcode fixture IDs;
- every declared case and variant exists before registration.

JSONata reads producer payload beneath `data` and runtime context beneath `_pulse`. Force arrays
where the canonical model requires arrays, omit absent optional values, and never use `$eval`,
network, filesystem, current time, or random values.
