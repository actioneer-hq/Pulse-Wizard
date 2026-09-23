import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PULSE_SETUP_PROMPT,
  allSetupAdapters,
  detectSetupAdapters,
} from "../src/adapters/registry.js";
import type { AdapterRuntime } from "../src/adapters/types.js";
import * as ui from "../src/prompts/ui.js";
import { setup } from "../src/setup/run.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../src/version.js";

vi.mock("../src/prompts/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/prompts/ui.js")>()),
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  line: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

function fakeRuntime(installed: string[] = []): AdapterRuntime & {
  calls: Array<{ command: string; args: string[]; cwd: string; inherit: boolean }>;
} {
  const calls: Array<{ command: string; args: string[]; cwd: string; inherit: boolean }> = [];
  return {
    platform: "linux",
    calls,
    commandExists: async (command) => installed.includes(command),
    pathExists: async () => false,
    run: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, inherit: options.inherit });
      return 0;
    },
  };
}

describe("setup adapter registry", () => {
  it("keeps the generated command version aligned with package metadata", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    expect([PACKAGE_NAME, PACKAGE_VERSION]).toEqual([packageJson.name, packageJson.version]);
  });

  it("lists the supported local agents and IDEs in display order", () => {
    expect(allSetupAdapters().map((adapter) => adapter.id)).toEqual([
      "claude-code",
      "codex",
      "opencode",
      "cursor-agent",
      "gemini-cli",
      "cursor-ide",
      "windsurf",
    ]);
  });

  it("detects installed commands and launches terminal agents with inherited stdio", async () => {
    const runtime = fakeRuntime(["codex"]);
    const detected = await detectSetupAdapters(runtime);
    const codex = detected.find((entry) => entry.adapter.id === "codex")!;

    expect(codex.detection.available).toBe(true);
    await codex.adapter.launch(
      { repo: "/repo", prompt: PULSE_SETUP_PROMPT },
      codex.detection,
      runtime,
    );

    expect(runtime.calls).toEqual([
      {
        command: "codex",
        args: [PULSE_SETUP_PROMPT],
        cwd: "/repo",
        inherit: true,
      },
    ]);
  });

  it("generates the native Windsurf workflow and opens the repository", async () => {
    const runtime = fakeRuntime(["windsurf"]);
    const detected = await detectSetupAdapters(runtime);
    const windsurf = detected.find((entry) => entry.adapter.id === "windsurf")!;
    const files = windsurf.adapter.supportFiles({ repo: "/repo", prompt: PULSE_SETUP_PROMPT });

    expect(files[0]?.path).toBe(".windsurf/workflows/pulse-setup.md");
    expect(files[0]?.content).toContain(".pulse/SETUP.md");
    await windsurf.adapter.launch(
      { repo: "/repo", prompt: PULSE_SETUP_PROMPT },
      windsurf.detection,
      runtime,
    );
    expect(runtime.calls[0]).toEqual({
      command: "windsurf",
      args: ["/repo"],
      cwd: "/repo",
      inherit: false,
    });
  });

  it("detects a macOS IDE app even when its shell command is unavailable", async () => {
    const runtime = fakeRuntime();
    Object.defineProperty(runtime, "platform", { value: "darwin" });
    runtime.pathExists = async (path) => path === "/Applications/Cursor.app";
    const detected = await detectSetupAdapters(runtime);
    const cursor = detected.find((entry) => entry.adapter.id === "cursor-ide")!;

    expect(cursor.detection).toEqual({
      available: true,
      target: { command: "open", argsPrefix: ["-a", "Cursor"] },
    });
  });
});

describe("one-command setup", () => {
  it("initializes dev state and launches an explicitly selected agent", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-setup-"));
    execFileSync("git", ["init", "-q", repo]);
    const runtime = fakeRuntime(["codex"]);

    await setup({ repo, dev: true, agent: "codex" }, { runtime });

    expect(runtime.calls[0]?.command).toBe("codex");
    expect(runtime.calls[0]?.args).toEqual([PULSE_SETUP_PROMPT]);
    expect(
      await readFile(join(repo, ".agents/skills/pulse-integration-mapping/SKILL.md"), "utf8"),
    ).toContain("Connect a voice agent to Pulse");
    expect(await readFile(join(repo, ".git/info/exclude"), "utf8")).toContain(
      "/.agents/skills/pulse-integration-mapping/",
    );
    expect(ui.select).not.toHaveBeenCalled();
  });

  it("finishes initialization with guidance when no adapter is installed", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-setup-empty-"));
    execFileSync("git", ["init", "-q", repo]);

    await setup({ repo, dev: true }, { runtime: fakeRuntime() });

    expect(ui.note).toHaveBeenCalledWith(
      expect.stringContaining(PULSE_SETUP_PROMPT),
      "Setup pending",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("asks the developer when several supported agents are available", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-setup-select-"));
    execFileSync("git", ["init", "-q", repo]);
    const runtime = fakeRuntime(["claude", "codex"]);
    vi.mocked(ui.select).mockResolvedValueOnce("codex");

    await setup({ repo, dev: true }, { runtime });

    expect(ui.select).toHaveBeenCalledWith(
      expect.objectContaining({ message: "What do you want to use to set up Pulse?" }),
    );
    expect(runtime.calls[0]?.command).toBe("codex");
  });
});
