import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JobKind } from "../flow/context.js";

/** Persisted, non-secret slice of a run — lets a re-run resume without re-asking everything.
 * Tokens are NOT stored here. Lives at <repo>/.pulse/session.json (gitignored). */
export interface WizardSession {
  pulseUrl?: string;
  agentId?: string;
  driverId?: string;
  job?: JobKind;
  updatedAt?: string;
}

function sessionPath(repo: string): string {
  return join(repo, ".pulse", "session.json");
}

export async function loadSession(repo: string): Promise<WizardSession> {
  try {
    return JSON.parse(await readFile(sessionPath(repo), "utf8")) as WizardSession;
  } catch {
    return {};
  }
}

export async function saveSession(repo: string, session: WizardSession): Promise<void> {
  const path = sessionPath(repo);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ ...session, updatedAt: new Date().toISOString() }, null, 2),
  );
}
