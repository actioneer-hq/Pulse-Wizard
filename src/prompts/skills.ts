import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WizardError } from "../util/errors.js";

/** Locate a bundled skill directory (`skills/<name>` or `src/skills/<name>`) by walking up from this
 * module — works both from source (tsx) and a built package. */
export function skillDir(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    for (const rel of [join("skills", name), join("src", "skills", name)]) {
      const candidate = join(dir, rel);
      if (existsSync(join(candidate, "SKILL.md"))) return candidate;
    }
    dir = dirname(dir);
  }
  throw new WizardError(`could not locate the '${name}' skill (SKILL.md not found)`);
}

/** Per-job artifact dir under the repo's gitignored .pulse/. Created if missing. */
export async function artifactDir(repo: string, job: string): Promise<string> {
  const dir = join(repo, ".pulse", "artifacts", job);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Path to a skill's validator script, if it ships one. */
export function validatorScript(dir: string): string {
  return join(dir, "scripts", "validate-mapping.mjs");
}

export function otlpPrompt(skill: string, repo: string, artifact: string): string {
  return [
    `Use the \`pulse-otlp-mapping\` Agent Skill. Read its full instructions at ${skill}/SKILL.md and`,
    "every file it references, then follow that workflow exactly.",
    "",
    `Producer repo to analyze: ${repo}`,
    `Write ALL deliverables to this artifact directory (never into the repo): ${artifact}`,
    "",
    "In addition to the skill's deliverables, write the single representative OTLP payload you",
    `validated against to ${artifact}/sample-otlp.json, so it can be re-validated independently.`,
    "",
    `Also write ${artifact}/integration.json with: {"framework": "<framework, e.g. livekit>",`,
    '"language": "<language>", "use_case": "<short, generic downstream market use-case this voice',
    "agent serves, e.g. 'outbound appointment reminders for clinics'>\"}. The use_case MUST be a",
    "generic market category, <=120 chars, with NO company/product/person names, NO code, NO PII.",
    'If you cannot tell, use "unknown".',
    "",
    "Finish only when the skill's validator passes with no errors.",
  ].join("\n");
}

/** Re-prompt the agent to fix a mapping the wizard's validator rejected. */
export function fixPrompt(mappingPath: string, validatorReport: string): string {
  return [
    "Your OTLP mapping FAILED the wizard's validator. Fix it — do not start over.",
    "",
    `Edit ${mappingPath} (and sample-otlp.json only if the sample itself is malformed) to resolve every`,
    "error below. Keep following the pulse-otlp-mapping skill rules: stay local (no web/MCP), force",
    "arrays for spans and events, seconds-from-call-start times, and an explicit turn_id on every",
    "turn-stage span. Re-write the corrected file to the same path.",
    "",
    "Validator output:",
    validatorReport,
  ].join("\n");
}

export function storagePrompt(skill: string, repo: string, artifact: string): string {
  return [
    `Use the \`pulse-storage-mapping\` Agent Skill. Read its full instructions at ${skill}/SKILL.md and`,
    "every file it references, then follow that workflow exactly.",
    "",
    `Producer repo to analyze: ${repo}`,
    `Write ALL deliverables to this artifact directory (never into the repo): ${artifact}`,
    "Determine caller/agent channel identity only from the repo's upload config — never guess. If it",
    "isn't clear, omit channel_map (Pulse resolves it at runtime).",
  ].join("\n");
}
