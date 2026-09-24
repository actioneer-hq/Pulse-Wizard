import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IntegrationManifest } from "../src/integration/manifest.js";
import {
  type MappingCase,
  type MappingPlan,
  canonicalFieldIds,
} from "../src/integration/mappingPlan.js";

export function manifest(): IntegrationManifest {
  return {
    schema: "pulse.integration",
    version: 1,
    ingest_method: "storage_polling",
    integration: { framework: "custom", language: "python", use_case: "support calls" },
    live_telemetry: {
      status: "unavailable",
      protocol: "otlp",
      reason: "The application does not create voice-stage spans.",
    },
    connections: [
      {
        id: "calls",
        driver: "gcs",
        service: "google_cloud_storage",
        location: { bucket: { from: "environment", name: "CALL_BUCKET" } },
        auth: {
          scheme: "gcs_service_account",
          fields: {
            "Service account JSON": {
              key: "service_account_json",
              secret: true,
              required: true,
            },
            "Project ID": { key: "project_id", secret: false, required: true },
          },
        },
        status: "needs_configuration",
      },
    ],
    artifacts: [
      {
        id: "conversation",
        connection: "calls",
        selector: { object_path_regex: "^calls/([^/]+)/conversation\\.md$" },
        container: { type: "none" },
        correlation: { call_id: { from: "path_capture", scope: "object", group: 1 } },
        decoder: { type: "text", encoding: "utf-8" },
        emits: [{ target: "transcript", mapper: "conversation-transcript" }],
      },
      {
        id: "events",
        connection: "calls",
        selector: { object_path_regex: "^calls/([^/]+)/events$" },
        container: { type: "none" },
        correlation: { call_id: { from: "path_capture", scope: "object", group: 1 } },
        decoder: { type: "json" },
        emits: [{ target: "trace", mapper: "events-trace" }],
      },
      {
        id: "recording",
        connection: "calls",
        selector: { object_path_regex: "^calls/([^/]+)/recording$" },
        container: { type: "none" },
        correlation: { call_id: { from: "path_capture", scope: "object", group: 1 } },
        decoder: { type: "audio", format: "wav" },
        emits: [
          {
            target: "audio",
            config: { layout: "stereo", channel_map: { "0": "agent", "1": "caller" } },
          },
        ],
      },
    ],
    mappers: {
      "conversation-transcript": {
        language: "jsonata",
        input: "text",
        output: "transcript",
        cardinality: "one",
        expression:
          '{"call_id":_pulse.call_id,"turns":[{"speaker":"caller","text":$substringBefore($substringAfter(data.text,"caller: "),"\\n"),"turn_id":"turn-1","sequence":0},{"speaker":"agent","text":$substringAfter(data.text,"agent: "),"turn_id":"turn-1","sequence":1}]}',
      },
      "events-trace": {
        language: "jsonata",
        input: "json",
        output: "trace",
        cardinality: "one",
        expression: '$merge([data.trace,{"call_id":_pulse.call_id}])',
      },
    },
    expected_capabilities: {},
  };
}

const TRANSCRIPT_FIELDS = [
  "Transcript.call_id",
  "Transcript.turns",
  "TranscriptTurn.speaker",
  "TranscriptTurn.text",
  "TranscriptTurn.turn_id",
  "TranscriptTurn.sequence",
];

const TRACE_FIELDS = [
  "TraceEvidence.call_id",
  "TraceEvidence.spans",
  "Span.span_id",
  "Span.parent_span_id",
  "Span.name",
  "Span.stage",
  "Span.t_start",
  "Span.t_end",
  "Span.turn_id",
  "Span.attrs",
  "Span.content",
  "Span.events",
  "SpanEvent.name",
  "SpanEvent.t",
  "SpanEvent.attrs",
  "SpanEvent.content",
];

const AUDIO_FIELDS = ["AudioEvidence.call_id", "AudioRef.channels", "AudioRef.channel_map"];

export function mappingPlan(): MappingPlan {
  const requirements: MappingPlan["requirements"] = Object.fromEntries(
    canonicalFieldIds().map((field) => [
      field,
      { status: "unavailable" as const, reason: "Producer code does not emit this field." },
    ]),
  );
  const map = (fields: string[], source: string) => {
    for (const field of fields) requirements[field] = { status: "mapped", sources: [source] };
  };
  map(TRANSCRIPT_FIELDS, "conversation-source");
  map(TRACE_FIELDS, "events-source");
  map(AUDIO_FIELDS, "recording-source");
  return {
    schema: "pulse.mapping-plan",
    version: 1,
    requirements,
    overlaps: [],
    sources: [
      {
        id: "conversation-source",
        producer: { file: "src/producer.py", symbol: "write_conversation" },
        artifact_ids: ["conversation"],
        mapper_ids: ["conversation-transcript"],
        format: {
          decoder: "text",
          cardinality: "one",
          description: "Two labelled UTF-8 lines, one per speaker.",
          variants: [
            {
              id: "labelled-lines",
              description: "Caller line followed by agent line.",
              cases: ["normal"],
            },
          ],
          projections: [
            {
              id: "turns",
              locator: "caller: and agent: labelled lines",
              canonical_fields: TRANSCRIPT_FIELDS,
              via: { mapper: "conversation-transcript" },
              use: "selected",
            },
          ],
        },
        path_cases: [
          {
            artifact_id: "conversation",
            object_path: "calls/synthetic-call/conversation.md",
            matches: true,
            call_id: "synthetic-call",
          },
          { artifact_id: "conversation", object_path: "calls/conversation.md", matches: false },
        ],
      },
      {
        id: "events-source",
        producer: { file: "src/producer.py", symbol: "write_events" },
        artifact_ids: ["events"],
        mapper_ids: ["events-trace"],
        format: {
          decoder: "json",
          cardinality: "one",
          description: "JSON object containing the trace fragment.",
          variants: [
            {
              id: "complete",
              description: "One LLM span carrying producer-reported numbers as attrs.",
              cases: ["complete"],
            },
          ],
          projections: [
            {
              id: "trace",
              locator: "/trace",
              canonical_fields: TRACE_FIELDS,
              via: { mapper: "events-trace" },
              use: "selected",
              unit_evidence: {
                source_api: "time.monotonic()",
                file: "src/producer.py",
                line: 2,
                source_unit: "s",
              },
            },
          ],
        },
        path_cases: [
          {
            artifact_id: "events",
            object_path: "calls/synthetic-call/events",
            matches: true,
            call_id: "synthetic-call",
          },
          { artifact_id: "events", object_path: "events/synthetic-call", matches: false },
        ],
      },
      {
        id: "recording-source",
        producer: { file: "src/producer.py", symbol: "write_recording" },
        artifact_ids: ["recording"],
        mapper_ids: [],
        format: {
          decoder: "audio",
          cardinality: "one",
          description: "Two-channel WAV with explicit caller and agent lanes.",
          variants: [
            {
              id: "stereo",
              description: "Channel 0 agent and channel 1 caller.",
              cases: ["stereo"],
            },
          ],
          projections: [
            {
              id: "audio-layout",
              locator: "WAV channel writer arguments",
              canonical_fields: AUDIO_FIELDS,
              via: { artifact: "recording" },
              use: "selected",
            },
          ],
        },
        path_cases: [
          {
            artifact_id: "recording",
            object_path: "calls/synthetic-call/recording",
            matches: true,
            call_id: "synthetic-call",
          },
          { artifact_id: "recording", object_path: "recordings/synthetic-call", matches: false },
        ],
      },
    ],
  };
}

function cases(): Record<string, Record<string, MappingCase>> {
  const trace = {
    call_id: "synthetic-call",
    spans: [
      {
        span_id: "span-1",
        parent_span_id: null,
        name: "generate",
        stage: "llm",
        t_start: 1,
        t_end: 1.2,
        turn_id: "turn-1",
        attrs: { "gen_ai.usage.output_tokens": 12, "endpointing.delay": 0.22 },
        content: { llm_spoken: "Hi" },
        events: [{ name: "llm.first_token", t: 1.1, attrs: {}, content: {} }],
      },
    ],
  };
  return {
    "conversation-source": {
      normal: {
        schema: "pulse.mapping-case",
        version: 1,
        source: "conversation-source",
        variant: "labelled-lines",
        input: {
          _pulse: {
            call_id: "synthetic-call",
            object_path: "calls/synthetic-call/conversation.md",
            member_path: null,
          },
          data: { text: "caller: Hello\nagent: Hi" },
        },
        expected: {
          "conversation-transcript": {
            call_id: "synthetic-call",
            turns: [
              { speaker: "caller", text: "Hello", turn_id: "turn-1", sequence: 0 },
              { speaker: "agent", text: "Hi", turn_id: "turn-1", sequence: 1 },
            ],
          },
        },
      },
    },
    "events-source": {
      complete: {
        schema: "pulse.mapping-case",
        version: 1,
        source: "events-source",
        variant: "complete",
        input: {
          _pulse: { call_id: "synthetic-call", object_path: "calls/synthetic-call/events" },
          data: { trace: { spans: trace.spans } },
        },
        expected: { "events-trace": trace },
      },
    },
    "recording-source": {
      stereo: {
        schema: "pulse.mapping-case",
        version: 1,
        source: "recording-source",
        variant: "stereo",
        input: {
          _pulse: { call_id: "synthetic-call", object_path: "calls/synthetic-call/recording" },
          data: { format: "wav", channels: 2 },
        },
        expected: {},
      },
    },
  };
}

export async function writeIntegration(repo: string): Promise<void> {
  const root = join(repo, ".pulse", "artifacts", "integration");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(
    join(repo, "src", "producer.py"),
    "def write_conversation(): pass\ndef write_events(): pass\ndef write_recording(): pass\n",
  );
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest()));
  await writeFile(join(root, "mapping-plan.json"), JSON.stringify(mappingPlan()));
  for (const [source, sourceCases] of Object.entries(cases())) {
    const dir = join(root, "fixtures", source);
    await mkdir(dir, { recursive: true });
    for (const [id, mappingCase] of Object.entries(sourceCases)) {
      await writeFile(join(dir, `${id}.json`), JSON.stringify(mappingCase));
    }
  }
}
