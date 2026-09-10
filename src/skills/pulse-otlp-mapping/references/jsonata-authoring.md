# JSONata authoring

## Input

Input is one call-sharded OTLP/JSON `ExportTraceServiceRequest`: it may contain multiple resources
or scopes, but every span has the same `traceId`. Protobuf must first be decoded into equivalent
OTLP JSON. Do not assume a single `resourceSpans`, `scopeSpans`, or instrumentation scope.

Attributes arrive as `{key, value}` arrays. Scalars may use `stringValue`, `intValue`,
`doubleValue`, or `boolValue`; OTLP integers may be strings. Handle arrays and key-value lists when
the mapped producer uses them.

## Required normalization

Implement small expression-local functions for:

- unboxing OTLP `AnyValue` values;
- flattening attribute arrays into objects;
- flattening every resource/scope/span while retaining its resource attributes;
- locating the root and computing `t0`;
- converting nanoseconds to relative seconds and UTC ISO timestamps;
- deriving stage and explicit turn correlation;
- normalizing events and errors.

## Safe patterns

- Use `$merge([base, condition ? {"key": value} : {}])` for optional output fields.
- **Force arrays for `spans` and `events`.** JSONata yields a *single object* (not a 1-element array)
  when a path matches once, and *nothing* when it matches zero times. `spans` and each span's `events`
  MUST be arrays. Wrap the mapped sequence in `[ ... ]` and coalesce empties, e.g.
  `"events": [ s.events.{ ... } ]` and, for a possibly-absent list, `[ $x ]` so one match still yields
  an array and none yields `[]`. The validator rejects a non-array `events`.
- Quote dotted source keys with backticks.
- Branch on resolved stage when one producer key has stage-dependent meaning.
- Build a span-ID lookup for nearest-turn ancestry; write the result directly to `turn_id`.
- Sort canonical spans by `t_start` for deterministic fixtures.
- Missing input means omitted canonical attributes, not invented zeros or false values.
- Never use `$eval` on input. It evaluates JSONata, not merely JSON. Embedded JSON strings require a
  trusted host preprocessing helper.

## Evidence

For each nontrivial mapping, record producer file/line or sample path, source field, unit, and
canonical destination. Temporal turn pairing requires source evidence that ordering is stable.

The wizard owns the executable starter template because it must stay versioned with its JSONata
runtime. Do not invent unsupported helper functions when adapting that template.
