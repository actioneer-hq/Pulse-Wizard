import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function notify(enabled: boolean, title: string, message: string): Promise<void> {
  if (!enabled) return;
  try {
    if (process.platform === "darwin") {
      const quote = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      await run("osascript", [
        "-e",
        `display notification "${quote(message)}" with title "${quote(title)}"`,
      ]);
      return;
    }
    if (process.platform === "linux") {
      await run("notify-send", [title, message]);
      return;
    }
  } catch {
    // Desktop notification is best effort.
  }
  if (process.stdout.isTTY) process.stdout.write("\u0007");
}
