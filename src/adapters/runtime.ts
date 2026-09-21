import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { WizardError } from "../util/errors.js";
import { commandExists } from "../util/exec.js";
import type { AdapterRuntime } from "./types.js";

export const systemRuntime: AdapterRuntime = {
  platform: process.platform,
  commandExists,
  pathExists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  run(command, args, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        stdio: options.inherit ? "inherit" : "ignore",
      });
      child.once("error", (error) =>
        reject(new WizardError(`could not launch ${command}: ${error.message}`)),
      );
      child.once("close", (code) => resolve(code ?? 1));
    });
  },
};
