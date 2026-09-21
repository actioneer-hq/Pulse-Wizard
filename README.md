# Pulse Wizard

Onboarding CLI for [Pulse](https://github.com/Glitchcraft-Inc/Actioneer-Pulse) — wires a voice
agent's telemetry into a self-hosted Pulse instance.

One command configures both parts of a complete Pulse integration:

- **OTLP** — launches your locally authenticated coding agent to generate a
  JSONata mapping from your producer's OTLP spans to Pulse's canonical shape, then registers it.
  The wizard never touches model keys; it uses the agent's own auth.
- **Storage** — inspects your upload code for recordings, archived OTLP, JSON artifacts, and ZIP
  members. You confirm each inferred rule before a versioned manifest is registered. No bucket
  credentials or sample objects are needed for discovery.

The Wizard uses your locally authenticated coding agent; it does not run a hosted model or ask for
its API key. Storage rules are derived from code and confirmed by you, not verified against live
bucket contents. Bucket access setup remains a separate Pulse concern.

## Quick start

1. Start or deploy Pulse and note its public URL.
2. In Pulse, select your organization, open **Settings → Agents**, create an agent, and mint an
   ingest token. Copy the token when shown; it is displayed only once.
3. From the root of your voice-agent repository, run:

   ```bash
   npx @actioneer/pulse-wizard@latest
   ```

The Wizard asks for the Pulse URL and token, detects the supported coding agents and IDEs installed
on the machine, and lets the developer choose one. Terminal agents open with the Pulse setup prompt
already submitted. Cursor and Windsurf receive a local `/pulse-setup` command and open the repository
with a one-line instruction.

Supported in the first release:

- Claude Code
- Codex
- OpenCode
- Cursor Agent and Cursor IDE
- Gemini CLI
- Windsurf

Pulse stores its token in `.pulse/config.json` with mode `0600` and keeps generated artifacts under
`.pulse/`. Wizard-generated skills and IDE commands are excluded through Git's local exclude file,
so setup does not dirty the repository. Run with `--reconfigure` to replace a saved URL or token.

## Develop

```bash
npm install
npm run dev            # run from source (tsx)
npm run build          # bundle to dist/ (tsup)
npm test               # vitest
npm run lint           # biome
npm run typecheck      # tsc --noEmit
npm run workbench:list # list pinned real-world test cases
```

## Run

```bash
# From the Pulse Wizard checkout; dev mode needs no Pulse URL or token:
npm run dev -- --repo /path/to/voice-agent --dev
```

The selected agent inspects live OTLP and call-linked blob logs, asks which primary source to use
when both exist, and asks permission before wiring a missing OTLP exporter. The ignored
`.pulse/SETUP.md` contains exact, version-pinned validation and registration commands. The old
subprocess-driven TUI remains available as `pulse-wizard run` during migration.

After updating Wizard, run
`npx @actioneer/pulse-wizard@latest refresh-skills --repo <target>` to replace previously installed
Pulse skills. It backs up existing copies under the target's ignored `.pulse/` directory and leaves
its connection config untouched. Restart the coding agent to load the new instructions.

Artifacts are written under `<repo>/.pulse/artifacts/`. The storage draft retains source evidence;
the confirmed `storage-manifest.json` contains only runtime fields. Production registration uses
`PUT /v1/ingest/storage-manifest` (manifest v1); Pulse must implement that endpoint before a
production storage run can complete. Dev mode sends the same HTTP requests to a short-lived
loopback mock; it does not verify production backend acceptance. If a skill lacks enough source
evidence, the run reports incomplete instead of claiming a working integration.

Trace mappings use `mapping-source.json` to distinguish `otlp` from `json_log`. The latter maps
source JSON directly to Pulse's canonical Trace and must reference a confirmed `kind: "log"`
storage rule. `validate-trace-mapping` checks either mode locally; the old `validate-otlp` and
`register-otlp` remain OTLP-compatible aliases. Production JSON-log registration targets
`PUT /v1/ingest/json-log-mapping`, which Pulse must implement separately. A source-derived
sample validates the expression but is not proof of deployed bucket contents.

## Layout

```
src/
  cli.ts          entry (arg parsing)
  adapters/       interactive terminal and IDE launch adapters
  setup/          one-command setup orchestration
  index.ts        run() — programmatic entry
  flow/           step orchestration (context, step, run)
  steps/          guided stages (select agent, connect, OTLP, storage, outro)
  drivers/        coding-agent abstraction (Driver) + headless + ACP + registry
  pulse/          PulseClient (Pulse API)
  prompts/        @clack/prompts wrapper
  config/         session persistence
  util/           exec, log, errors
  skills/         OTLP and blob-storage Agent Skills bundled as progressive context
workbench/        pinned real-world repos for end-to-end wizard testing
```
