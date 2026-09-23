import { parseArgs } from "node:util";
import { localCommand } from "./commands/local.js";
import type { CliFlags } from "./config/flags.js";
import { init, refreshSkills } from "./config/init.js";
import { setup } from "./setup/run.js";

const HELP = `pulse-wizard - connect a voice-agent repository to Pulse

Usage:
  pulse-wizard [options]
  pulse-wizard setup [options]
  pulse-wizard init [options]
  pulse-wizard refresh-skills --repo <path>
  pulse-wizard validate-integration --repo <path>
  pulse-wizard register-integration --repo <path>

Options:
  --repo <path>       repo to work in (default: cwd)
  --pulse-url <url>   public Pulse endpoint
  --token <token>     agent ingest token
  --org <slug>        Pulse org slug (default: default)
  --agent <id>        claude-code | codex | opencode | cursor-agent | gemini-cli | cursor-ide | windsurf
  --dev               use a local mock Pulse API; no URL or token
  --reconfigure       replace the saved Pulse URL and token
  -h, --help          show this help
`;

function parse(): { command: string; flags: CliFlags } {
  const { values, positionals } = parseArgs({
    options: {
      repo: { type: "string" },
      "pulse-url": { type: "string" },
      token: { type: "string" },
      org: { type: "string" },
      agent: { type: "string" },
      dev: { type: "boolean" },
      reconfigure: { type: "boolean" },
      help: { type: "boolean", short: "h" },
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
    flags: {
      repo: values.repo,
      pulseUrl: values["pulse-url"],
      token: values.token,
      org: values.org,
      agent: values.agent,
      dev: values.dev,
      reconfigure: values.reconfigure,
    },
  };
}

const { command, flags } = parse();
const task =
  command === "setup"
    ? setup(flags)
    : command === "init"
      ? init(flags.repo ?? process.cwd(), flags)
      : command === "refresh-skills"
        ? refreshSkills(flags.repo ?? process.cwd())
        : localCommand(command, flags.repo ?? process.cwd());
task.catch((error) => {
  process.stderr.write(`${(error as Error).stack ?? error}\n`);
  process.exit(1);
});
