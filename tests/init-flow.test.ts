import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { init } from "../src/config/init.js";
import * as ui from "../src/prompts/ui.js";

vi.mock("../src/prompts/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/prompts/ui.js")>()),
  note: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
}));

describe("init", () => {
  it("installs one skill and writes the unified local workflow", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-init-"));
    execFileSync("git", ["init", "-q", repo]);
    await init(repo, { dev: true });

    const setup = await readFile(join(repo, ".pulse/SETUP.md"), "utf8");
    expect(setup).toContain("pulse-integration-mapping");
    expect(setup).toContain("validate-integration");
    expect(setup).toContain("register-integration");
    expect(setup).not.toContain("validate-storage");
    expect(setup).not.toContain("HMAC access ID ->");
    expect(
      await readFile(join(repo, ".agents/skills/pulse-integration-mapping/SKILL.md"), "utf8"),
    ).toContain("Work backward");
    const contract = JSON.parse(
      await readFile(join(repo, ".pulse/contracts/canonical.json"), "utf8"),
    );
    expect(Object.keys(contract.atomic_families)).toEqual(["trace", "audio", "transcript"]);
    expect(contract.relationships.inheritance).toContain("Transcript extends CallEvidence");
    expect((await stat(join(repo, ".pulse/config.json"))).mode & 0o777).toBe(0o600);
  });

  it("backs up and removes legacy split skills", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-migrate-"));
    execFileSync("git", ["init", "-q", repo]);
    const old = join(repo, ".agents/skills/pulse-otlp-mapping/SKILL.md");
    await mkdir(join(repo, ".agents/skills/pulse-otlp-mapping"), { recursive: true });
    await writeFile(old, "old local skill");

    await init(repo, { dev: true });

    await expect(access(old)).rejects.toThrow();
    const [backup] = await readdir(join(repo, ".pulse/generated-backups"));
    expect(
      await readFile(
        join(
          repo,
          ".pulse/generated-backups",
          backup!,
          ".agents/skills/pulse-otlp-mapping/SKILL.md",
        ),
        "utf8",
      ),
    ).toBe("old local skill");
  });
});
