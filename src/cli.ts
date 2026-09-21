import { parseArgs } from "node:util";
import { localCommand } from "./commands/local.js";
import { init, refreshSkills } from "./config/init.js";
import type { CliFlags } from "./flow/context.js";
import { run } from "./index.js";
import { setup } from "./setup/run.js";

const HELP = `pulse-wizard — onboard a voice agent into a self-hosted Pulse

Usage:
  pulse-wizard [options]
  pulse-wizard setup [options]
  pulse-wizard init [options]
  pulse-wizard refresh-skills --repo <path>
  pulse-wizard validate-trace-mapping|register-trace-mapping [options]
  pulse-wizard validate-otlp|register-otlp|validate-storage|register-storage [options]
  pulse-wizard run [options]  (legacy driven flow)

Options:
  --repo <path>       repo to work in (default: cwd)
  --pulse-url <url>   Pulse endpoint (skips the prompt)
  --token <token>     agent ingest token (skips the prompt)
  --org <slug>        Pulse org slug (default: default)
  --agent <id>        claude-code | codex | opencode | cursor-agent | gemini-cli | cursor-ide | windsurf
  --dev               validate locally and mock Pulse registration; no URL or token
  --reconfigure       replace the saved Pulse URL and token
  --notify            desktop notifications for attention and completion
  --no-notify         disable notifications without prompting
  --confirmed         storage findings were confirmed by the developer
  --verbose           extra logging
  -h, --help          show this help
`;

function parse(): { command: string; flags: CliFlags; confirmed: boolean } {
  const { values, positionals } = parseArgs({
    options: {
      repo: { type: "string" },
      "pulse-url": { type: "string" },
      token: { type: "string" },
      org: { type: "string" },
      agent: { type: "string" },
      verbose: { type: "boolean" },
      dev: { type: "boolean" },
      reconfigure: { type: "boolean" },
      notify: { type: "boolean" },
      "no-notify": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      confirmed: { type: "boolean" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (positionals.length > 1) throw new Error("expected one command");
  return {
    command: positionals[0] ?? "setup",
    confirmed: Boolean(values.confirmed),
    flags: {
      repo: values.repo,
      pulseUrl: values["pulse-url"],
      token: values.token,
      org: values.org,
      agent: values.agent,
      verbose: values.verbose,
      dev: values.dev,
      reconfigure: values.reconfigure,
      notify: values["no-notify"] ? false : values.notify,
    },
  };
}

const { command, flags, confirmed } = parse();
const task =
  command === "setup"
    ? setup(flags)
    : command === "init"
      ? init(flags.repo ?? process.cwd(), flags)
      : command === "refresh-skills"
        ? refreshSkills(flags.repo ?? process.cwd())
        : command === "run"
          ? run(flags)
          : localCommand(command, flags.repo ?? process.cwd(), confirmed);
task.catch((e) => {
  process.stderr.write(`${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
