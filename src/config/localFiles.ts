import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { GeneratedSupportFile } from "../adapters/types.js";
import { skillDir } from "../prompts/skills.js";
import { WizardError } from "../util/errors.js";
import { exec } from "../util/exec.js";

interface GeneratedState {
  version: 1;
  paths: Record<string, string>;
}

function portable(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function gitRepo(repo: string): Promise<boolean> {
  const result = await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repo });
  return result.code === 0 && result.stdout.trim() === "true";
}

async function appendMissing(path: string, patterns: string[]): Promise<void> {
  const current = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = patterns.filter((pattern) => !lines.has(pattern));
  if (!missing.length) return;
  await mkdir(dirname(path), { recursive: true });
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  await writeFile(path, `${current}${separator}${missing.join("\n")}\n`);
}

export async function ensureLocalExcludes(repo: string, paths: string[]): Promise<void> {
  const patterns = paths.map(
    (path) => `/${portable(path).replace(/\/$/, "")}${path.endsWith("/") ? "/" : ""}`,
  );
  if (!(await gitRepo(repo))) {
    await appendMissing(join(repo, ".gitignore"), patterns);
    return;
  }
  const result = await exec("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: repo });
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new WizardError("could not locate Git's local exclude file");
  }
  const excludePath = resolve(repo, result.stdout.trim());
  await appendMissing(excludePath, patterns);
}

async function tracked(repo: string, path: string): Promise<boolean> {
  if (!(await gitRepo(repo))) return false;
  const result = await exec("git", ["ls-files", "--cached", "--", portable(path)], { cwd: repo });
  return result.code === 0 && Boolean(result.stdout.trim());
}

export async function assertLocalPathsUntracked(repo: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    if (await tracked(repo, path)) {
      throw new WizardError(
        `${portable(path)} is tracked by Git; move or untrack it before Pulse writes local setup files`,
      );
    }
  }
}

async function filesUnder(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function hashDirectory(path: string): Promise<string> {
  const hash = createHash("sha256");
  for (const file of await filesUnder(path)) {
    hash.update(portable(relative(path, file)));
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

function hashText(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function backupPath(repo: string, source: string, backupRoot: string): Promise<void> {
  if (!(await exists(source))) return;
  const destination = join(backupRoot, relative(repo, source));
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

export async function installLocalFiles(
  repo: string,
  skillHomes: string[],
  supportFiles: GeneratedSupportFile[],
): Promise<string | undefined> {
  const skillPaths = skillHomes.flatMap((home) =>
    ["pulse-otlp-mapping", "pulse-storage-mapping"].map((name) => join(home, name)),
  );
  const supportPaths = supportFiles.map((file) => file.path);
  const generatedPaths = [...skillPaths, ...supportPaths];
  await assertLocalPathsUntracked(repo, [".pulse", ...generatedPaths]);
  await ensureLocalExcludes(repo, [
    ".pulse/",
    ...skillPaths.map((path) => `${path}/`),
    ...supportPaths,
  ]);

  const state: GeneratedState = { version: 1, paths: {} };
  let backupRoot: string | undefined;
  const backup = async (path: string) => {
    backupRoot ??= join(
      repo,
      ".pulse",
      "generated-backups",
      new Date().toISOString().replaceAll(":", "-"),
    );
    await backupPath(repo, path, backupRoot);
  };

  for (const targetRelative of skillPaths) {
    const name = targetRelative.endsWith("pulse-otlp-mapping")
      ? "pulse-otlp-mapping"
      : "pulse-storage-mapping";
    const source = skillDir(name);
    const target = join(repo, targetRelative);
    const sourceHash = await hashDirectory(source);
    const targetHash = (await exists(target)) ? await hashDirectory(target) : undefined;
    if (targetHash !== sourceHash) {
      if (targetHash) await backup(target);
      await rm(target, { recursive: true, force: true });
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { recursive: true });
    }
    state.paths[portable(targetRelative)] = sourceHash;
  }

  for (const file of supportFiles) {
    const target = join(repo, file.path);
    const current = await readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (current !== file.content) {
      if (current !== undefined) await backup(target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    state.paths[portable(file.path)] = hashText(file.content);
  }

  await mkdir(join(repo, ".pulse"), { recursive: true });
  await writeFile(join(repo, ".pulse", "generated.json"), `${JSON.stringify(state, null, 2)}\n`);
  return backupRoot;
}
