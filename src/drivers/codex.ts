import { HeadlessDriver, type Sink } from "./headless.js";
import type { DriverId, RunOptions } from "./types.js";

/** OpenAI Codex CLI, driven headlessly (`codex exec --json`). Uses the user's own Codex auth
 * (ChatGPT subscription or OPENAI_API_KEY). Emits a JSONL stream of ThreadEvents.
 *
 * NOTE: wire-level field casing (`item.completed` and the `details.type` strings) should be confirmed
 * against a real `codex exec --json` run; the parser tolerates a couple of likely spellings. */
export class CodexDriver extends HeadlessDriver {
  readonly id: DriverId = "codex";
  readonly label = "Codex";
  protected readonly bin = "codex";

  protected buildArgs(prompt: string, _opts: RunOptions): string[] {
    // workspace-write lets it edit files non-interactively; prompt is the positional arg.
    return ["exec", "--json", "--sandbox", "workspace-write", prompt];
  }

  protected parseLine(ev: Record<string, unknown>, sink: Sink): void {
    const type = String(ev.type ?? "").toLowerCase();
    if (!type.includes("item") || !type.includes("completed")) {
      if (type.includes("item")) sink.emit("tool", type); // item.started etc. → progress
      return;
    }
    const item = (ev.item ?? {}) as Record<string, unknown>;
    const details = (item.details ?? item) as Record<string, unknown>;
    const dtype = String(details.type ?? item.type ?? "").toLowerCase();

    if (dtype.includes("agent") && dtype.includes("message")) {
      const text = details.text ?? item.text;
      if (typeof text === "string") sink.text = text; // final assistant message
    } else if (dtype.includes("file") && dtype.includes("change")) {
      const changes = (details.changes ?? item.changes ?? []) as Array<Record<string, unknown>>;
      for (const ch of changes) {
        if (typeof ch.path === "string") sink.filesEdited.add(ch.path);
      }
    }
  }
}
