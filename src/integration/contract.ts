export const CANONICAL_CONTRACT = {
  schema: "pulse.canonical-contract",
  version: 2,
  principle: {
    identity:
      "Identity fields (call_id, span_id) are required and never null — nothing can be assembled, joined, or erased without them — but they put zero burden on the producer: a mapper mints them deterministically from whatever per-call artifact exists (filename, directory, hash).",
    evidence:
      "Evidence fields (every timing field, turn_id, sequence, every CallHeader fact, AudioRef details) are nullable. Null means the producer never had this fact. Nothing is ever invented — no fabricated timestamps, no guessed spans. Pulse computes only what the evidence supports and its trust report names what is missing.",
    floor:
      "A span must assert at least one fact (a stage, a time, content, attrs, or events). A producer that logs nothing yields no rows at all — an honest empty state, not null husks.",
    ordering:
      "Ordering is the universal concept; time is merely its best source. Order by t_start when present, by sequence (source order) when not. An untimed span must carry sequence.",
    units:
      "One canonical unit, no unit fields anywhere: relative times are seconds from call t0, absolute times are ISO-8601, durations are seconds. Unit variance is resolved inside the mapper expression (ms/1000, (ns-t0_ns)/1e9), never carried as data.",
  },
  atomic_families: {
    trace: {
      description:
        "Call identity and spans/events/content. Producer-reported numbers (ttft, tokens, chars) ride span attrs from the vocabulary below — never a separate measurements payload.",
      mapper_outputs: ["call", "trace"],
    },
    audio: {
      description: "Original call audio with its physical layout and explicit speaker mapping.",
      mapper_outputs: ["audio"],
    },
    transcript: {
      description:
        "Original ordered, speaker-labelled conversation content. Mapper-side sugar: Pulse canonicalizes each turn into an untimed STT (caller) or TTS (agent) span carrying the turn's text and sequence, so the span stays the single atomic unit.",
      mapper_outputs: ["transcript"],
    },
  },
  span_attr_vocabulary: {
    description:
      "Canonical span attribute names for producer-reported numbers. Values must already be in canonical units when emitted; the conversion lives in the mapper.",
    attrs: {
      "metrics.ttft": "LLM time to first token, seconds (on the llm span)",
      "metrics.ttfb": "TTS time to first byte/audio, seconds (on the tts span)",
      "metrics.e2e_latency": "producer's own end-to-end latency, seconds (any turn-scoped span)",
      "endpointing.delay": "endpointing hold, seconds (turn/stt span)",
      "gen_ai.usage.input_tokens": "count (llm span)",
      "gen_ai.usage.output_tokens": "count (llm span)",
      "gen_ai.usage.cached_tokens": "count (llm span)",
      "tts.chars": "characters sent to TTS, count (tts span)",
      "tts.chars_cut": "characters cut by interruption, count (tts span)",
      "stt.confidence": "recognizer confidence 0..1 (stt span)",
      "turn.interrupted": "boolean (turn span)",
      "turn.index": "producer's own turn ordinal (turn span)",
    },
  },
  relationships: {
    base: "CallEvidence",
    inheritance: [
      "TraceEvidence extends CallEvidence",
      "AudioEvidence extends CallEvidence",
      "Transcript extends CallEvidence",
    ],
    composition:
      "A call analysis composes TraceEvidence, AudioEvidence, and Transcript. None substitutes for another and TraceEvidence does not inherit Transcript.",
  },
  mapper_input: {
    required: ["_pulse", "data"],
    fields: {
      _pulse: {
        required: ["call_id"],
        fields: {
          call_id: "string|null; null only for multi-call mapper inputs",
          object_path: "string|null",
          member_path: "string|null",
        },
      },
      data: "decoded producer payload",
    },
  },
  models: {
    CallEvidence: {
      required: ["call_id"],
      fields: { call_id: "string" },
    },
    CallHeader: {
      required: ["call_id"],
      fields: {
        call_id: "string",
        source: "string|null",
        environment: "string|null",
        started_at: "ISO-8601 datetime|null; null = producer never logged a wall clock",
        ended_at: "ISO-8601 datetime|null",
        engine: "string|null",
        carrier: "string|null",
        stt_provider: "string|null",
        llm_provider: "string|null",
        llm_model: "string|null",
        tts_provider: "string|null",
        voice: "string|null",
        template_sha256: "string|null",
        labels: "object",
        counters: "object",
      },
    },
    SpanEvent: {
      required: ["name"],
      fields: {
        name: "string",
        t: "nonnegative seconds from call t0|null; null = source had no clock",
        attrs: "object",
        content: "object",
      },
    },
    Span: {
      required: ["span_id", "name", "stage"],
      fields: {
        span_id: "string; identity — mapper mints one when the producer has none",
        parent_span_id: "string|null",
        name: "string",
        stage: "call|turn|speech|stt|llm|tts|playout|tool|net|unknown",
        t_start: "nonnegative seconds from call t0|null; null = source had no clock",
        t_end: "nonnegative seconds from call t0|null",
        sequence:
          "nonnegative integer|null; source order — the sort key when there is no clock; required when t_start is null",
        turn_id: "string|null",
        error: "boolean",
        attrs: "object; shape only — see span_attr_vocabulary for producer-reported numbers",
        content:
          "object; transcript (stt) | llm_raw (llm) | llm_spoken (tts) — speaker implied by stage",
        events: "SpanEvent[]",
      },
    },
    TraceEvidence: {
      extends: "CallEvidence",
      required: ["call_id", "spans"],
      fields: { call_id: "string", header: "CallHeader|null", spans: "Span[]" },
    },
    TranscriptTurn: {
      required: ["speaker", "text"],
      fields: {
        speaker: "caller|agent|system|tool|unknown",
        text: "string",
        turn_id: "string|null",
        sequence:
          "nonnegative integer|null; required when t_start is null — line order is the only order",
        t_start: "nonnegative seconds from call t0|null",
        t_end: "nonnegative seconds from call t0|null",
        language: "string|null",
      },
    },
    Transcript: {
      extends: "CallEvidence",
      required: ["call_id", "turns"],
      fields: { call_id: "string", turns: "TranscriptTurn[]" },
      canonicalization:
        "Pulse converts each turn to one untimed span: caller→stage stt with content.transcript, agent→stage tts with content.llm_spoken, system/tool/unknown→stage unknown with attrs.speaker; sequence and turn_id carry over. The span remains the single atomic unit.",
    },
    AudioRef: {
      required: ["uri"],
      fields: {
        uri: "runtime storage URI; identity — the reference IS the artifact",
        sha256: "string|null; Pulse computes from the file when absent",
        channels: "positive integer|null; decoded from the file when absent",
        sample_rate: "positive integer Hz|null; decoded from the file when absent",
        duration_s: "nonnegative seconds|null; decoded from the file when absent",
        channel_map:
          "object mapping physical channel indexes to caller|agent|mixed|null; carried when the producer proves it, else null — Pulse detects and trust-notes. Never assume channel zero is the caller.",
        t0_offset_s: "number|null",
      },
    },
    AudioEvidence: {
      extends: "CallEvidence",
      required: ["call_id", "audio"],
      fields: { call_id: "string", audio: "AudioRef" },
    },
  },
  inclusion_rules: [
    "Include every independently persisted or emitted source that deterministically populates at least one canonical field.",
    "When sources overlap, ask the developer to select one primary source for duplicated fields while preserving unique fields from every source.",
    "A deterministic text or Markdown writer is mappable even when delimiters vary by a deterministic escaping algorithm.",
    "Exclude a source only when it adds no canonical field or is derived analysis such as a summary, classification, RCA result, or aggregate report.",
    "Never emit a derived metric (latency, ratio, count, percentile) as data — producer-reported numbers enter only as span attrs from span_attr_vocabulary, already converted to canonical units.",
  ],
} as const;
