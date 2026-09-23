# Pulse Wizard

One-command onboarding from a voice-agent repository to Pulse. The Wizard initializes a private
local workspace, installs one integration skill, and opens the developer's local coding agent with
the setup prompt already submitted.

## Quick start

1. Deploy Pulse at a public URL.
2. In Pulse, add an agent to your organization and mint its ingest token.
3. From the voice-agent repository, run:

   ```bash
   npx @actioneer/pulse-wizard@latest
   ```

Enter the Pulse URL and token, then choose a detected coding agent or IDE. Claude Code, Codex,
OpenCode, Cursor Agent, and Gemini CLI open directly with the prompt preloaded. Cursor and Windsurf
open the repository with a local `/pulse-setup` command ready to run.

The agent works backward from Pulse's canonical Trace, Audio, and Transcript models, declares each
selected source's exact format, validates its mappers against expected canonical output, and
registers the result. It does not need bucket access, production samples, calls, or credentials.

## Supported launchers

- Claude Code
- Codex
- OpenCode
- Cursor Agent and Cursor IDE
- Gemini CLI
- Windsurf

For another coding harness, initialize the repository and submit the generated instruction:

```bash
npx @actioneer/pulse-wizard@latest init
```

Then ask the agent: `Read .pulse/SETUP.md and complete the Pulse setup.`

## Local state

Wizard state lives under `.pulse/` and is excluded locally from Git. `.pulse/config.json` stores
the Pulse URL and ingest token with mode `0600`. Generated skills and IDE commands are also locally
excluded so setup does not dirty the target repository.

`.pulse/contracts/canonical.json` contains the versioned Trace/OTLP, Audio, and Transcript models
the coding agent must map to. Mapper fixtures use a standard `_pulse` runtime context plus decoded
`data`; validation rejects hardcoded synthetic call IDs.

The integration contract is written to:

```text
.pulse/artifacts/integration/
  manifest.json
  mapping-plan.json
  coverage.json
  fixtures/<source-id>/<case-id>.json
```

The registered contract uses `PUT /v1/ingest/integration-manifest`. Validation always runs again
immediately before registration.

## Development

```bash
npm install
npm run dev -- --repo /path/to/voice-agent --dev
npm run typecheck
npm run lint
npm test
npm run build
```

`--dev` skips the Pulse URL and token and registers against a short-lived loopback mock while
keeping the same validation and HTTP flow.

## Layout

```text
src/
  adapters/      coding-agent and IDE launch adapters
  commands/      local validation and registration commands
  config/        private initialization and generated-file management
  integration/   manifest, canonical models, and deterministic validator
  pulse/         production API client and development mock
  setup/         one-command setup orchestration
  skills/        bundled pulse-integration-mapping skill
workbench/       pinned real-world repositories for manual end-to-end testing
```
