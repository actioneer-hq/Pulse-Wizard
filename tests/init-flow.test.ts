import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localCommand } from "../src/commands/local.js";
import { init, refreshSkills } from "../src/config/init.js";
import * as ui from "../src/prompts/ui.js";

vi.mock("../src/prompts/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/prompts/ui.js")>()),
  note: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("agent-owned init flow", () => {
  it("refuses to overwrite tracked agent support files", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-tracked-skill-"));
    execFileSync("git", ["init", "-q", repo]);
    const tracked = join(repo, ".agents/skills/pulse-otlp-mapping/SKILL.md");
    await mkdir(dirname(tracked), { recursive: true });
    await writeFile(tracked, "tracked project skill\n");
    execFileSync("git", ["-C", repo, "add", ".agents"]);

    await expect(init(repo, { dev: true })).rejects.toThrow(/tracked by Git/);
    expect(await readFile(tracked, "utf8")).toBe("tracked project skill\n");
  });

  it("backs up modified installed skills before refreshing them", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-refresh-"));
    execFileSync("git", ["init", "-q", repo]);
    await init(repo, { dev: true });
    const installed = join(repo, ".claude/skills/pulse-storage-mapping/SKILL.md");
    await writeFile(installed, "user-customized skill\n");
    await rm(join(repo, ".pulse"), { recursive: true });

    await refreshSkills(repo);

    expect(await readFile(installed, "utf8")).toContain("storage object keys");
    const backups = join(repo, ".pulse/generated-backups");
    const [run] = await readdir(backups);
    expect(
      await readFile(join(backups, run!, ".claude/skills/pulse-storage-mapping/SKILL.md"), "utf8"),
    ).toBe("user-customized skill\n");
  });

  it("installs both skills and registers through a loopback mock in dev mode", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-init-"));
    execFileSync("git", ["init", "-q", repo]);
    const realFetch = globalThis.fetch;
    const requests: string[] = [];
    const fetch = vi.fn((input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      requests.push(url);
      return realFetch(input, init);
    });
    vi.stubGlobal("fetch", fetch);
    await init(repo, { dev: true });

    expect(await readFile(join(repo, ".git/info/exclude"), "utf8")).toContain("/.pulse/");
    expect(JSON.parse(await readFile(join(repo, ".pulse/config.json"), "utf8"))).toEqual({
      dev: true,
      org: "default",
    });
    expect((await stat(join(repo, ".pulse/config.json"))).mode & 0o777).toBe(0o600);
    const setup = await readFile(join(repo, ".pulse/SETUP.md"), "utf8");
    expect(setup).toContain(`--repo '${repo}'`);
    expect(setup).toContain("@actioneer/pulse-wizard@0.1.0");
    expect(setup).toContain(".pulse/ is Wizard working state, not producer evidence");
    expect(setup).toContain("Assume I know my application and storage, not Pulse internals");
    expect(setup).toContain("ask me to correct factual mistakes, not to design the manifest");
    expect(setup).toContain("Do not ask me to confirm known credential-label mappings");
    expect(setup).toContain("HMAC access ID -> access_key_id");
    expect(setup).toContain("HMAC secret -> secret_access_key");
    expect(setup).toContain("selectable question UI when available");
    expect(setup).toContain("accept either a number or a custom answer");
    for (const home of [".agents/skills", ".claude/skills"]) {
      for (const name of ["pulse-otlp-mapping", "pulse-storage-mapping"]) {
        expect(await readFile(join(repo, home, name, "SKILL.md"), "utf8")).toContain(
          ".pulse/SETUP.md",
        );
      }
    }
    expect(ui.text).not.toHaveBeenCalled();
    expect(ui.password).not.toHaveBeenCalled();

    const otlp = join(repo, ".pulse/artifacts/otlp");
    await mkdir(otlp, { recursive: true });
    await copyFile(join(fixtures, "minimal-mapping.jsonata"), join(otlp, "mapping.jsonata"));
    await copyFile(join(fixtures, "minimal-otlp.json"), join(otlp, "sample-otlp.json"));
    await writeFile(join(otlp, "integration.json"), JSON.stringify({ framework: "livekit" }));
    await localCommand("register-otlp", repo);

    const storage = join(repo, ".pulse/artifacts/storage");
    await mkdir(storage, { recursive: true });
    const manifest = {
      version: 1,
      sources: [
        {
          id: "calls",
          provider: "s3_compatible",
          bucket: "audio",
          prefix: "calls/",
          rules: [
            {
              id: "recording",
              path_regex: "^calls/([^/]+)/recording\\.wav$",
              role: "recording",
              decoder: "audio",
              call_id: { from: "object_path", group: 1 },
            },
          ],
        },
      ],
    };
    await writeFile(
      join(storage, "storage-draft.json"),
      JSON.stringify({
        manifest,
        evidence: {
          recording: { source: "src/upload.py:10", reason: "key builder", certainty: "proven" },
        },
      }),
    );
    await localCommand("validate-storage", repo);
    await writeFile(join(storage, "storage-manifest.json"), JSON.stringify(manifest));
    await expect(localCommand("register-storage", repo)).rejects.toThrow(/--confirmed/);
    await localCommand("register-storage", repo, true);
    expect(requests.map((url) => new URL(url).pathname)).toEqual([
      "/v1/ingest/otlp-mapping",
      "/v1/ingest/agent-meta",
      "/v1/ingest/storage-manifest",
    ]);
  });
});
