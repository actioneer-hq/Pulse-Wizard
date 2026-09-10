---
name: pulse-storage-mapping
description: >-
  Connect Pulse to existing call recordings or archived OTLP in S3-compatible or Azure Blob
  storage by inspecting upload code, proving object-key and call-ID correlation, describing file
  roles, and configuring channel identity without guessing. Use for blob storage and backfill;
  use pulse-otlp-mapping for live OTLP dialect transforms.
license: MIT
---

# Map existing blob storage into Pulse

Produce a storage configuration that lets Pulse list objects, extract each external call ID, assign
known file roles, and fetch recordings or archived OTLP. Do not move customer data or redesign their
storage layout.

## Required evidence

Inspect the code that writes recordings/traces and at least three representative object keys. For
audio, inspect container metadata or upload configuration to determine channel count and speaker
identity. Never infer speaker identity from channel position.

Do not read or return credential values. Identify only the credential field names Pulse must ask the
developer to provide.

**Stay local.** Work only from the producer repo and this skill's references — no web search, no
external docs, no MCP servers, and do not read files outside the repo and the artifact directory.

## Supported providers

- `s3_compatible`: AWS S3, R2, MinIO, B2, Spaces, Wasabi, Ceph, and GCS through S3 interoperability.
- `azure`: Azure Blob Storage.

Native `gs://` is not currently supported. Use GCS interoperability credentials or report the
driver requirement instead of pretending the connection will work.

## Descriptor

```jsonc
{
  "provider": "s3_compatible",
  "descriptor": {
    "bucket": "recordings",
    "list_prefix": "calls/",
    "key_regex": "calls/(?P<call_id>[^/]+)/[^/]+$",
    "id_group": "call_id",
    "id_maps_to": "external_call_id",
    "file_map": {
      "spans.json": "otlp",
      "audio.wav": "audio",
      "caller.wav": "audio_caller",
      "agent.wav": "audio_agent"
    }
  },
  "cred_spec": [],
  "credentials": {}
}
```

`key_regex` runs in Python against the bucket-relative key. Named groups must therefore use Python
syntax: `(?P<call_id>...)`. The selected `id_group` must exist and extract exactly the external call
ID found in OTLP. `file_map` matches object basenames exactly.

## File roles

| Role | Meaning |
|---|---|
| `otlp` | One saved OTLP export for the call. |
| `audio` | One combined recording, mono or stereo. |
| `audio_caller` | Caller-only mono recording. |
| `audio_agent` | Agent-only mono recording. |
| `peaks` | Precomputed waveform peaks, when Pulse format is proven. |
| `segments` | Precomputed speech segments, when Pulse format is proven. |
| `artifact_json` | Additional Pulse-compatible artifact metadata. |

Do not invent a role for unrecognized files.

## Audio identity

- Separate caller and agent files: use `audio_caller` and `audio_agent`; no channel map is needed.
- Split stereo: prove the channel map from source configuration before registration.
- Mixed stereo or mono: use `audio`; do not provide speaker channel roles. Accurate per-speaker
  analysis requires configured diarization.

Pulse can detect mono, separated, or mixed layout from waveform correlation. That does not reveal
which separated channel is caller. `channel_map` determines identity and is never guessed.

Current pull-backfill limitation: Pulse does not yet copy a channel map from the storage descriptor
onto each call. It currently interprets separated stereo as channel 0 caller and channel 1 agent.
Register split stereo only when source evidence proves that exact order. If the order differs or is
unknown, report the runtime blocker; do not generate a configuration that silently swaps speakers.

## Workflow

1. Identify provider, bucket/container, endpoint, and smallest safe listing prefix.
2. Derive one regex from upload code, then test it against representative and adversarial keys.
3. Verify the captured ID exactly matches OTLP `traceId` or the call ID used by Pulse.
4. Map only filenames proven by code or samples.
5. Determine audio layout and channel identity from source configuration or separate-track names;
   apply the current split-stereo limitation above.
6. List required credential fields, marking secrets without reading their values.
7. Test list permission and read permission on a developer-selected sample object.
8. Return configuration and a concise evidence report. Register only after the developer confirms
   the bucket scope and extracted call IDs.

## Credential fields

`cred_spec` is a list of field descriptors. **Each entry MUST use these exact keys** (Pulse reads
`name` and `secret`; a `field` key or a missing `name` is wrong):

```jsonc
{ "name": "secret_access_key", "label": "Secret access key", "type": "password", "secret": true }
```

`type` is `text` or `password`; `secret: true` marks values Pulse encrypts and never echoes. Put the
field names only in `cred_spec` — never real values (leave `credentials` as `{}`).

For `s3_compatible`, request only what the environment needs: `access_key_id`,
`secret_access_key`, `region`, and optional `endpoint_url`. The runtime default credential chain may
remove the need for explicit keys.

For `azure`, use one supported path: `connection_string`; `account_name` + `account_key`; or
`account_name` + `sas_token`. `account_url` is optional for custom endpoints.

## Deliverables

- `storage-config.json`: provider, descriptor, credential specification, and no secret values.
- `storage-notes.md`: evidence for key matching, call-ID correlation, file roles, audio layout, and
  unsupported objects.

Historical OTLP is available only when matching `otlp` objects actually exist. Audio alone supports
audio analysis, not historical STT/LLM/TTS internals.
