---
name: pulse-storage-mapping
description: >-
  Discover every run-related blob artifact and its storage object-key layout from producer code,
  then confirm and register a Pulse storage manifest. Use for arbitrary files and ZIP members;
  do not request bucket access or credentials.
license: MIT
---

# Discover run artifacts in blob storage

The goal is to connect the **target voice-agent application** to Pulse observability. Inspect
the application's blob-write producers. `.pulse/` is Wizard working state inside the checkout,
not application source or evidence of what is in the bucket. Earlier drafts and samples can
help resume work, but verify every finding against producer code.

Run inside the developer's own coding agent after `pulse-wizard init`. Read `.pulse/SETUP.md` for
the exact local CLI commands. Never read `.pulse/config.json` or print a token; the CLI handles
authentication. Write artifacts under `.pulse/artifacts/storage/`. Ask the developer about every
finding in this agent UI; do not defer questions to another TUI.

Here, **path means a file's object key in blob storage**, relative to its bucket/container. It
never means the path of a source file in the repository. Read the producer's upload, key-building,
serialization, archive, and configuration code to infer those storage object keys and what each
object contains. Repo file/line references are evidence for an inference, not storage paths.
Do not require bucket access, real object samples, credentials, or a live call. Every inferred
layout needs developer confirmation. Registration only attaches the manifest; a later pull is
the first check against actual bucket contents.

Stay local to the producer repo, this skill, and the supplied artifact directory. Do not use web,
MCP, or external services. Never read or output secret values.

## Discovery

- Inventory **every blob write relevant to an agent run**, not just recordings. Follow call sites
  through serializers, upload helpers, provider selection, and key builders. Record each distinct
  artifact and conditional layout, including files whose content or meaning is not yet clear.
  Do not start from a list of familiar artifact types, filenames, or extensions. An artifact can
  have no extension, an unexpected extension, or share a directory with unrelated files.
- For each artifact, infer the bucket/container, full bucket-relative object-key expression,
  optional runtime prefix, content shape, and how a call ID is obtained. Separate locations may
  need separate sources or rules. Do not infer that a possible code branch is active in deployment;
  ask the developer which provider, layout, and configured prefix they use.
- Identify the **actual storage service** separately from the Pulse driver: for example, Cloudflare
  R2 uses `provider: "s3_compatible"` and `service: "cloudflare_r2"`. Confirm the service,
  bucket/container name, endpoint, and region with the developer. Do not confuse a vendor name
  with a bucket name or infer a production bucket from a sample/default config.
- Inspect credential *field names* or UI labels without reading credential values. Map each
  provider-side field name to the Pulse driver key in `credential_mapping`. Ask the developer
  to correct unknown names; never ask them to paste secrets into this agent UI or manifest.
- Derive `path_regex` from the **object-key expression**, not from repo filenames or examples.
  Use anchored JavaScript-compatible regexes with numbered captures. Derive `prefix` as the
  storage listing scope for that source: every confirmed key covered by its rules must start
  with it. Do not choose a narrow prefix from one layout if another confirmed layout falls
  outside it.
- Follow archive creation code. Model a ZIP as an object rule with `container: "zip"` and
  `members` for each relevant member key. A member may obtain call ID from its own path, the object
  path, or JSON content. Describe nested ZIPs as unresolved; do not invent support.
- For JSON arrays or envelopes, identify `records_pointer` and a per-record `call_id` pointer.
  This is essential when one object contains multiple calls.
- Infer artifact roles and decoders from producer behavior, not extension. A parseable JSON log
  can use `json`; an unparsed but call-correlated file can use `opaque`. If content or correlation
  cannot be established, report the artifact to the developer and add it to `unresolved`; do not silently
  discard it or invent a valid rule. Explain if the current manifest cannot represent it.
- Assign each rule a coarse `kind` (`otlp`, `log`, `metadata`, `audio`, `transcript`, or `other`)
  **from producer semantics**, while keeping `role` as the precise, producer-specific meaning.
  Do not classify by filename, extension, or familiar directory name. ZIP parents are `other`;
  classify each relevant member independently. A JSON log is `log`, not `otlp`, even when it
  contains trace-like timing. OTLP JSON is `otlp` only when it is an actual export payload.
- If live voice OTLP is absent, rank call-linked JSON logs by their ability to supply call ID,
  timestamps, turn boundaries, stage events, and metric inputs. Report the best candidate's
  full bucket-relative object-key expression, `path_regex`, rule ID, field evidence, and gaps
  to `pulse-otlp-mapping`. Do not claim the bucket contains a file merely because code builds
  its key. If OTLP also exists, still report logs so the developer can choose a source.
- For every audio artifact, determine the physical layout: one mono object, one two-channel
  stereo object, or two separate mono objects (dual mono). Trace how channels/tracks are written
  and identify caller/human vs agent. Never assume channel 0 is caller. If source cannot prove
  layout or speaker identity, put it in `unresolved` and ask the developer; do not register an
  invented channel map.
- Historical audio alone does not imply historical OTLP, logs, or internal LLM/TTS metrics.

Show every discovered run-related artifact in the agent chat, including those not yet
representable in the manifest. For each, show its **storage** object-key template, contents,
call-ID basis, source-code evidence, and whether it is proposed, unresolved, or excluded after
developer review. Put unresolved artifacts in the draft's `unresolved` array. Never present a
synthetic key as an observed bucket object. Do not write a separate Markdown inventory.

Before review, derive at least one synthetic **storage object key** from each key-building branch
and check it against the proposed source prefix, every regex, and call-ID capture. Include ZIP
member keys where relevant. A key outside its listing prefix or matching an unintended rule is
a design error to resolve before confirmation. These local checks test the manifest's logic,
not whether any object exists in the bucket.

## Draft format

Write `storage-draft.json` in the requested artifact directory. This is a local review document,
not the registered manifest. Its shape:

```json
{
  "manifest": {
    "version": 1,
    "sources": [{
      "id": "run-artifacts",
      "provider": "s3_compatible",
      "service": "example_object_store",
      "bucket": "example-bucket",
      "prefix": "runs/",
      "credential_mapping": {
        "Object store access key ID": "access_key_id",
        "Object store secret key": "secret_access_key"
      },
      "rules": [{
        "id": "run-payload",
        "path_regex": "^runs/([^/]+)/payload$",
        "role": "run_payload",
        "kind": "other",
        "decoder": "opaque",
        "call_id": {"from": "object_path", "group": 1}
      }]
    }]
  },
  "evidence": {
    "run-payload": {
      "source": "src/upload.py:42",
      "reason": "The object key is built from the call ID and a payload basename.",
      "certainty": "proven"
    }
  },
  "unresolved": []
}
```

The example shows syntax only. Never assume that a producer writes a `payload` file or uses
`runs/`; derive every rule from that producer's code and confirm the runtime layout.

`provider` selects Pulse's driver: `s3_compatible` or `azure`. `service` names the actual store
(AWS S3, Cloudflare R2, GCS interoperability, Backblaze B2, MinIO, Azure Blob, or another
confirmed service); it is free text, not a hardcoded vendor list. GCS via HMAC and its S3
interoperability endpoint can use `s3_compatible`; native Google credentials cannot use that
driver and must be reported unresolved. `bucket` is the actual production bucket or Azure
container name, not a vendor name. `prefix` is a bucket-relative
listing scope, not a filesystem path or a guessed root. Use the narrowest scope that still lists
every confirmed object key in that source; use separate sources if layouts need different listing
scopes. `endpoint` and `region` are optional nonsecret hints. The manifest must contain no
credentials or secret values.

`credential_mapping` maps **provider-side field names or developer-facing labels** to Pulse's
normalized credential JSON keys; it contains names only, never values. For `s3_compatible`,
the currently supported keys are `access_key_id`, `secret_access_key`, `endpoint_url`, and
`region`. Examples: Backblaze `keyID -> access_key_id`, `applicationKey -> secret_access_key`;
GCS interoperability `HMAC access ID -> access_key_id`, `HMAC secret -> secret_access_key`.
For `azure`, the supported keys are `account_name`, `account_key`, `connection_string`,
`sas_token`, and `account_url`; map the confirmed Azure auth path, not S3-style keys. Confirm
the source labels and auth method with the developer. If a deployment uses temporary S3
credentials with a session token, report that as unresolved: Pulse's S3 driver does not yet
accept an explicit session token. This mapping is metadata for a later Pulse credential form;
it does not grant access or contain credentials. Never invent a key pair from code defaults.

`path_regex` is matched against the full bucket-relative object key, or full ZIP member key for
a member rule. It must be anchored at both ends and use portable numbered captures. `role` is a
developer-readable semantic label derived from content, not a fixed filename or extension list.
`kind` is a coarse semantic enum: `otlp`, `log`, `metadata`, `audio`, `transcript`, or `other`.
It is not a filename or extension list. `otlp` requires `otlp_json`, `log` requires `json`, and
`audio` requires `audio` decoder. Unclassified relevant artifacts use `other` plus an exact
free-text `role`, not an invented familiar type.
Choose the supported decoder by content: `"audio"`, `"otlp_json"`, `"json"`, or `"opaque"`.
For every `audio` rule, include an `audio` object. Use
`{"layout":"stereo","channel_map":{"0":"caller","1":"agent"}}` for a two-channel object,
reversing the map if producer code proves the opposite. Use
`{"layout":"mono","speaker":"mixed"}` for a single mixed mono object; a mono track with one
speaker uses `"caller"` or `"agent"`. For two separate mono objects, create a rule for each
with `{"layout":"dual_mono","speaker":"caller","pair_id":"recording"}` and the matching
agent rule with the same `pair_id`. The pair ID links the two tracks of one call; both rules
must resolve the same call ID. Show this layout and speaker mapping in the developer
confirmation, even when the source code appears conclusive.
Do not claim arbitrary audio codecs are decodable; mark uncertain codecs unresolved. A ZIP parent
uses `container: "zip"`, `decoder: "opaque"`, and `members` with the same rule shape. Each rule
and member needs a unique ID and a call-ID resolver. `call_id` is either:

- `{ "from": "object_path", "group": 1 }` using a numbered capture in the parent object regex;
- `{ "from": "member_path", "group": 1 }` using a numbered capture in the member regex;
- `{ "from": "json", "pointer": "/call_id" }` using RFC 6901 JSON Pointer within the selected
  JSON record. `records_pointer` selects an array from the object or member document before the
  call-ID pointer is evaluated per record.

If call correlation, provider, bucket, runtime prefix, or object-key layout cannot be inferred,
do not fabricate a valid rule. Report the artifact to the developer, put the question in
`unresolved`, and explain what developer correction is needed. If no relevant blob producer
exists, write `{"status":"no_storage","reason":"..."}` instead of a manifest. If the
confirmed provider is unsupported, write
`{"status":"unsupported_provider","reason":"...","unresolved":["..."]}` instead.
These are the only blocked draft shapes; do not add an inventory filename, provisional rules,
or an empty manifest. Show candidate object keys and other findings in the agent chat. Run
`validate-storage` on the blocked draft too, fix validation errors, and report the blocker;
do not attempt `register-storage` until there is a supported, confirmed manifest.

For every rule, add `evidence[rule.id]` with repo-relative file/line, a short rationale, and
`certainty: "proven"` or `"inferred"`. Keep evidence and `unresolved` in the draft only. The
wizard removes them from the final registered manifest after review. Never include tokens,
credentials, object payloads, or PII in these fields.

Run `validate-storage` from `.pulse/SETUP.md` after drafting. On developer correction, revisit
the relevant source and revise the draft, preserving unaffected rule IDs. Show the
developer **all discovered artifacts**, including unresolved or excluded ones, grouped by their
inferred **blob-storage object-key templates**. For each proposed rule, show the path regex,
content meaning, decoder, and call-ID resolver. Confirm driver, actual service, bucket/container,
endpoint, region, credential field mapping, runtime prefix, active
layouts, and every artifact separately; do not treat a bucket answer as a prefix answer. Ask
about every unresolved item. Allow corrections or explicit exclusion, but do not silently omit
files merely because their role is unfamiliar. If the developer confirms no relevant blob
producer exists, report that and stop without a manifest.

Before finalizing, revisit all discovered blob-write call sites and account for each run-related
output in the agent chat as included, unresolved, or explicitly excluded. An unfamiliar file is
not a reason to omit it. After confirmation, rerun the synthetic-key checks against the revised
manifest. Do not proceed while an included artifact or runtime prefix remains unresolved; report
the blocker instead.
Write `storage-manifest.json` containing only the validated `manifest` object: strip `evidence`
and `unresolved`, omit explicitly rejected or unrepresentable rules, and do not invent
credentials. Run
`register-storage --confirmed` from `.pulse/SETUP.md`; it validates and sends the manifest in
one command. Do not run it until the developer has confirmed the final findings. Report the
command result, but never claim live bucket verification from code inspection alone.
