# Pulse Wizard

Onboarding CLI for [Pulse](https://github.com/Glitchcraft-Inc/Actioneer-Pulse) — wires a voice
agent's telemetry into a self-hosted Pulse instance.

Two jobs:

- **OTLP** — drives your own coding agent (Claude Code, Codex, or any ACP agent) to generate a
  JSONata mapping from your producer's OTLP spans → Pulse's canonical shape, then registers it.
  The wizard never touches model keys; it uses the agent's own auth.
- **Audio storage** — points Pulse at your call recordings (S3/Azure).

> Status: **skeleton (P0)**. The flow runs end-to-end; the jobs are stubs. Real context injection,
> the mapping skill, driver execution, and validation land next.

## Develop

```bash
npm install
npm run dev            # run from source (tsx)
npm run build          # bundle to dist/ (tsup)
npm test               # vitest
npm run lint           # biome
npm run typecheck      # tsc --noEmit
```

## Run

```bash
node dist/cli.js --repo . --pulse-url http://localhost:8000
# or once published: npx pulse-wizard
```

## Layout

```
src/
  cli.ts          entry (arg parsing)
  index.ts        run() — programmatic entry
  flow/           step orchestration (context, step, run)
  steps/          guided stages (select agent, connect, choose job, otlp, blob, outro)
  drivers/        coding-agent abstraction (Driver) + headless + ACP + registry
  pulse/          PulseClient (Pulse API)
  prompts/        @clack/prompts wrapper
  config/         session persistence
  util/           exec, log, errors
  skills/         Agent Skills bundled as context (pulse-otlp-mapping/SKILL.md)
```
