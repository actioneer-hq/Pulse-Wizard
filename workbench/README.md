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

## Use

```bash
npm run workbench:list
npm run workbench:materialize -- livekit-python-starter
npm run dev -- --repo workbench/checkouts/livekit-python-starter
```

Pass `all` to materialize every case. Pipecat uses sparse checkout, so only its relevant example is
placed in the worktree. Delete a checkout to recreate it from its pinned commit.

Agent output and captured telemetry belong under the checkout's `.pulse/` directory. Add sanitized,
deterministic OTLP captures to `tests/fixtures/` only when they are useful in CI.
