#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workbenchDir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(workbenchDir, "cases.json"), "utf8"));
const checkoutsDir = join(workbenchDir, "checkouts");

function run(args, cwd) {
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

function materialize(testCase) {
  const target = join(checkoutsDir, testCase.id);
  if (existsSync(target)) {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: target,
      encoding: "utf8",
    }).trim();
    if (head !== testCase.commit) {
      throw new Error(`${testCase.id} exists at ${head}; delete it to restore the pinned commit`);
    }
    console.log(`${testCase.id}: already materialized`);
    return;
  }

  mkdirSync(target, { recursive: true });
  run(["init", "--quiet"], target);
  run(["remote", "add", "origin", testCase.repository], target);
  run(["fetch", "--depth", "1", "origin", testCase.commit], target);
  if (testCase.subdirectory) {
    run(["sparse-checkout", "init", "--cone"], target);
    run(["sparse-checkout", "set", testCase.subdirectory], target);
  }
  run(["checkout", "--quiet", "--detach", "FETCH_HEAD"], target);
  console.log(`${testCase.id}: ${target}`);
}

const requested = process.argv[2];

if (requested === "--list") {
  for (const testCase of manifest.cases) {
    console.log(
      `${testCase.id}\t${testCase.framework}\t${testCase.language}\t${testCase.scenario}`,
    );
  }
} else {
  const selected =
    requested === "all" ? manifest.cases : manifest.cases.filter((c) => c.id === requested);
  if (!requested || selected.length === 0) {
    console.error("Usage: npm run workbench:materialize -- <case-id|all>");
    process.exitCode = 1;
  } else {
    mkdirSync(checkoutsDir, { recursive: true });
    for (const testCase of selected) materialize(testCase);
  }
}
