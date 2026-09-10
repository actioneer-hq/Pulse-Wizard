import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Step } from "../flow/step.js";
import { artifactDir, skillDir, storagePrompt } from "../prompts/skills.js";
import * as ui from "../prompts/ui.js";
import { WizardError } from "../util/errors.js";

/** Optional: drive the agent to produce a storage config (recordings / archived OTLP in blob storage)
 * from the repo's upload code, and register it with Pulse. Skipped unless the user opts in. */
export const blobJob: Step = {
  id: "blob-job",
  title: "Audio storage",
  async run(ctx) {
    if (!ctx.driver || !ctx.pulse) return; // OTLP step already validated these

    const wants = await ui.select<boolean>({
      message: "Configure audio/recording storage now?",
      options: [
        { value: false, label: "No", hint: "skip — span metrics work without it" },
        { value: true, label: "Yes", hint: "point Pulse at your recordings (S3/Azure)" },
      ],
    });
    if (!wants) return;

    const skill = skillDir("pulse-storage-mapping");
    const artifact = await artifactDir(ctx.repoPath, "storage");

    const s = ui.spinner();
    s.start("Inspecting your upload config and building the storage descriptor…");
    await ctx.driver.run(storagePrompt(skill, ctx.repoPath, artifact), {
      repo: ctx.repoPath,
      contextFiles: [artifact],
      onEvent: (e) => {
        if (e.kind === "tool") s.message(`agent: ${e.message}`);
      },
    });
    s.stop("Agent finished.");

    const configPath = join(artifact, "storage-config.json");
    if (!existsSync(configPath)) throw new WizardError("agent did not produce storage-config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    await ctx.pulse.putBlobConfig(config);
    ui.note("Registered storage config.", "Audio storage");
  },
};
