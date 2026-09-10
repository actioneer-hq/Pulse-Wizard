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
    // --skip-git-repo-check: exec is non-interactive and can't answer the trust prompt codex
    // otherwise raises outside a recognised trusted dir.
    return ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", prompt];
  }

  protected parseLine(ev: Record<string, unknown>, sink: Sink): void {
    const type = String(ev.type ?? "").toLowerCase();
    if (!type.includes("item")) return;
    const item = (ev.item ?? {}) as Record<string, unknown>;
    const details = (item.details ?? item) as Record<string, unknown>;
    const dtype = String(details.type ?? item.type ?? "").toLowerCase();

    // Terminal side effects, captured on completed items.
    if (type.includes("completed")) {
      if (dtype.includes("agent") && dtype.includes("message")) {
        const text = details.text ?? item.text;
        if (typeof text === "string") sink.text = text; // final assistant message
        return;
      }
      if (dtype.includes("file") && dtype.includes("change")) {
        const changes = (details.changes ?? item.changes ?? []) as Array<Record<string, unknown>>;
        for (const ch of changes) {
          if (typeof ch.path === "string") sink.filesEdited.add(ch.path);
        }
      }
    }

    // Progress: describe every item action (started/updated/completed) except the final message,
    // in the same "verb + target" shape as the Claude Code driver.
    if (dtype.includes("agent") && dtype.includes("message")) return;
    const desc = describeItem(dtype, details, item);
    if (desc) sink.emit("tool", desc);
  }
}

/** Turn a Codex thread item into a short "verb target" progress label (best-effort; wire-level
 * field names vary, so match loosely and fall back to the item type). */
function describeItem(
  dtype: string,
  details: Record<string, unknown>,
  item: Record<string, unknown>,
): string {
  if (dtype.includes("command") || dtype.includes("exec")) {
    return `run ${String(details.command ?? item.command ?? "")}`.trim();
  }
  if (dtype.includes("file") && dtype.includes("change")) {
    const changes = (details.changes ?? item.changes ?? []) as Array<Record<string, unknown>>;
    const paths = changes.map((c) => c.path).filter((p): p is string => typeof p === "string");
    return `edit ${paths.join(", ")}`.trim();
  }
  if (dtype.includes("tool") || dtype.includes("mcp")) {
    const name = details.name ?? item.name ?? "tool";
    const target = details.path ?? details.arguments ?? item.path ?? "";
    return `${String(name)} ${String(target)}`.trim();
  }
  return dtype; // fallback: at least the item type, so progress is never blank
}
