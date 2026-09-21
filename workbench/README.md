# Wizard Workbench

Disposable copies of real voice-agent repositories for end-to-end wizard testing.
Third-party source is never committed here: `cases.json` pins every repository and commit, while
`checkouts/` is gitignored.

## Cases

| Case | What it tests |
| --- | --- |
| `livekit-python-starter` | LiveKit-native telemetry discovery and Python integration |
| `livekit-node-starter` | The same path in TypeScript |
| `pipecat-jaeger` | Discovery and mapping of an existing Pipecat OTLP setup |
| `fixtures/storage-artifact-mix` | Local source fixture for artifact-agnostic storage discovery |

## Use

```bash
npm run workbench:list
npm run workbench:materialize -- livekit-python-starter
npm run dev -- --repo workbench/checkouts/livekit-python-starter
npm run dev -- --repo workbench/checkouts/livekit-python-starter --dev --agent codex
```

Pass `all` to materialize every case. Pipecat uses sparse checkout, so only its relevant example is
placed in the worktree. Delete a checkout to recreate it from its pinned commit.

Agent output and captured telemetry belong under the checkout's `.pulse/` directory. Add sanitized,
deterministic OTLP captures to `tests/fixtures/` only when they are useful in CI.
Dev mode validates locally without Pulse credentials or network registration. The storage skill
uses upload source code only; it does not enumerate a real bucket.

For a storage-skill trial, run `pulse-wizard init --dev` against
`workbench/fixtures/storage-artifact-mix`, then ask your agent to use `pulse-storage-mapping`.
It should find the dynamic-extension stream, extensionless JSON snapshot, per-record JSON logs,
and both ZIP members. `README` is unrelated to a run. `expected.json` holds synthetic keys and
the expected manifest shape; it is not evidence of real bucket objects.
