import { parseArgs } from "node:util";
import type { CliFlags } from "./flow/context.js";
import { run } from "./index.js";

const HELP = `pulse-wizard — onboard a voice agent into a self-hosted Pulse

Usage:
  pulse-wizard [options]

Options:
  --repo <path>       repo to work in (default: cwd)
  --pulse-url <url>   Pulse endpoint (skips the prompt)
  --token <token>     Pulse ingest/API token (skips the prompt)
  --agent <id>        coding agent: claude-code | codex | acp
  --verbose           extra logging
  -h, --help          show this help
`;

function parse(): CliFlags {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      "pulse-url": { type: "string" },
      token: { type: "string" },
      agent: { type: "string" },
      verbose: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  return {
    repo: values.repo,
    pulseUrl: values["pulse-url"],
    token: values.token,
    agent: values.agent,
    verbose: values.verbose,
  };
}

run(parse()).catch((e) => {
  process.stderr.write(`${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
