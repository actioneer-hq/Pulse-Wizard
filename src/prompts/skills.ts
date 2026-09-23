import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WizardError } from "../util/errors.js";

export function skillDir(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 6; index++) {
    for (const relative of [join("skills", name), join("src", "skills", name)]) {
      const candidate = join(dir, relative);
      if (existsSync(join(candidate, "SKILL.md"))) return candidate;
    }
    dir = dirname(dir);
  }
  throw new WizardError(`could not locate the '${name}' skill (SKILL.md not found)`);
}
