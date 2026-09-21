import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Step } from "../flow/step.js";
import { withAgentProgress } from "../prompts/progress.js";
import {
  artifactDir,
  skillDir,
  storageCorrectionPrompt,
  storagePrompt,
} from "../prompts/skills.js";
import * as ui from "../prompts/ui.js";
import { validateDraft, validateManifest } from "../storage/manifest.js";
import { WizardError } from "../util/errors.js";
import { notify } from "../util/notify.js";

const MAX_REVISIONS = 3;

export const blobJob: Step = {
  id: "blob-job",
  title: "Storage discovery",
  async run(ctx) {
    if (!ctx.driver) throw new WizardError("no coding agent selected");
    if (!ctx.pulse) throw new WizardError("not connected to Pulse");
    const skill = skillDir("pulse-storage-mapping");
    const artifact = await artifactDir(ctx.repoPath, "storage");
    const draftPath = join(artifact, "storage-draft.json");
    const driver = ctx.driver;
    const runAgent = (prompt: string) =>
      withAgentProgress("Storage discovery", Boolean(ctx.flags.verbose), (onEvent) =>
        driver.run(prompt, { repo: ctx.repoPath, contextFiles: [artifact], onEvent }),
      );

    await runAgent(storagePrompt(skill, ctx.repoPath, artifact));
    if (!existsSync(draftPath)) throw new WizardError("agent did not produce storage-draft.json");
    let revisions = 0;
    let ignored = new Set<string>();

    while (true) {
      const raw = JSON.parse(await readFile(draftPath, "utf8"));
      if (raw?.status === "no_storage") {
        ui.note(`No storage producer found: ${String(raw.reason ?? "unknown")}`, "Storage");
        await notify(Boolean(ctx.flags.notify), "Pulse Wizard", "Storage finding needs review");
        const answer = await ui.select<"confirm" | "correct">({
          message: "Is it correct that this repo does not write call artifacts to blob storage?",
          options: [
            { value: "confirm", label: "Yes" },
            { value: "correct", label: "No, correct it" },
          ],
        });
        if (answer === "confirm") {
          ctx.artifacts.storage = "not_found";
          return;
        }
        if (++revisions > MAX_REVISIONS)
          throw new WizardError("storage review exceeded three agent revisions");
        const correction = await ui.text({
          message: "Where is storage written?",
          validate: (v) => (v.trim() ? undefined : "enter a correction"),
        });
        await runAgent(storageCorrectionPrompt(skill, artifact, "no_storage", correction));
        continue;
      }
      const draft = validateDraft(raw);
      if ("status" in draft) {
        ui.note(`Storage blocked (${draft.status}): ${draft.reason}`, "Storage");
        ctx.artifacts.storage = draft.status;
        return;
      }
      if (draft.unresolved?.length) {
        ui.note(draft.unresolved.join("\n"), "Unresolved storage details");
        if (++revisions > MAX_REVISIONS)
          throw new WizardError("storage questions remain unresolved");
        const answer = await ui.text({
          message: "Clarify these storage details",
          validate: (v) => (v.trim() ? undefined : "enter a clarification"),
        });
        await runAgent(storageCorrectionPrompt(skill, artifact, "unresolved", answer));
        ignored = new Set();
        continue;
      }

      let correction: { id: string; text: string } | undefined;
      for (const source of draft.manifest.sources) {
        for (const rule of source.rules) {
          for (const item of [rule, ...(rule.members ?? [])]) {
            if (ignored.has(item.id)) continue;
            const evidence = draft.evidence[item.id]!;
            ui.note(
              `${source.provider}:${source.bucket}/${source.prefix}\n${item.path_regex}\n${item.role} (${item.decoder}) · call ID: ${JSON.stringify(item.call_id)}\n${evidence.certainty}: ${evidence.reason}\nSource: ${evidence.source}`,
              `Artifact ${item.id}`,
            );
            await notify(Boolean(ctx.flags.notify), "Pulse Wizard", "Storage rule needs review");
            const answer = await ui.select<"confirm" | "correct" | "ignore">({
              message: `Is ${item.id} correct?`,
              options: [
                { value: "confirm", label: "Yes" },
                { value: "correct", label: "Correct it" },
                { value: "ignore", label: "Ignore this artifact" },
              ],
            });
            if (answer === "ignore") ignored.add(item.id);
            if (answer === "correct") {
              correction = {
                id: item.id,
                text: await ui.text({
                  message: "What should change?",
                  validate: (v) => (v.trim() ? undefined : "enter a correction"),
                }),
              };
              break;
            }
          }
          if (correction) break;
        }
        if (correction) break;
      }
      if (correction) {
        if (++revisions > MAX_REVISIONS)
          throw new WizardError("storage review exceeded three agent revisions");
        await runAgent(storageCorrectionPrompt(skill, artifact, correction.id, correction.text));
        ignored = new Set();
        continue;
      }

      const manifest = structuredClone(draft.manifest);
      for (const source of manifest.sources) {
        source.rules = source.rules
          .filter((rule) => !ignored.has(rule.id))
          .map((rule) => ({
            ...rule,
            members: rule.members?.filter((member) => !ignored.has(member.id)),
          }));
        source.rules = source.rules.filter(
          (rule) => rule.members === undefined || rule.members.length > 0,
        );
      }
      manifest.sources = manifest.sources.filter((source) => source.rules.length > 0);
      if (!manifest.sources.length) {
        ui.note("All storage artifacts were ignored; no manifest registered.", "Storage");
        ctx.artifacts.storage = "ignored";
        return;
      }
      validateManifest(manifest);
      await writeFile(
        join(artifact, "storage-manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await ctx.pulse.putStorageManifest(manifest);
      ui.note(
        ctx.flags.dev
          ? "Simulated registration of confirmed storage manifest."
          : "Registered confirmed storage manifest.",
        "Storage",
      );
      ctx.artifacts.storage = ctx.flags.dev ? "simulated" : "registered";
      return;
    }
  },
};
