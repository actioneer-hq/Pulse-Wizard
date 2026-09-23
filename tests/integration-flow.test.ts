import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localCommand } from "../src/commands/local.js";
import { init } from "../src/config/init.js";
import { validateIntegration } from "../src/integration/validator.js";
import { writeIntegration } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

describe("integration flow", () => {
  it("validates source-derived fixtures and derives coverage", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-integration-"));
    await writeIntegration(repo);
    const result = await validateIntegration(repo);

    expect(result.coverage.transcript?.status).toBe("available");
    expect(result.coverage.audio_analysis?.status).toBe("available");
    expect(result.coverage.timed_spans?.status).toBe("available");
    expect(result.coverage.span_attrs?.evidence).toContain("endpointing.delay");
    expect(result.coverage.span_attrs?.evidence).toContain("gen_ai.usage.output_tokens");
    expect(result.fragments["conversation-transcript"]?.[0]).toMatchObject({
      call_id: "synthetic-call",
      turns: [
        { speaker: "caller", text: "Hello" },
        { speaker: "agent", text: "Hi" },
      ],
    });
  });

  it("registers one manifest through the dev mock", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-register-"));
    await init(repo, { dev: true });
    await writeIntegration(repo);
    const realFetch = globalThis.fetch;
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      paths.push(new URL(url).pathname);
      return realFetch(input, options);
    });

    await localCommand("register-integration", repo);
    expect(paths).toEqual(["/v1/ingest/integration-manifest"]);
  });

  it("rejects mappers that hardcode the synthetic call ID", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-hardcoded-id-"));
    await writeIntegration(repo);
    const path = join(repo, ".pulse/artifacts/integration/manifest.json");
    const value = JSON.parse(await readFile(path, "utf8"));
    value.mappers["conversation-transcript"].expression = value.mappers[
      "conversation-transcript"
    ].expression.replace("_pulse.call_id", '"synthetic-call"');
    await writeFile(path, JSON.stringify(value));

    await expect(validateIntegration(repo)).rejects.toThrow(/hardcodes call_id/);
  });

  it("rejects mapper output that disagrees with the declared format case", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-semantic-output-"));
    await writeIntegration(repo);
    const path = join(
      repo,
      ".pulse/artifacts/integration/fixtures/conversation-source/normal.json",
    );
    const value = JSON.parse(await readFile(path, "utf8"));
    value.expected["conversation-transcript"].turns[0].text = "Different";
    await writeFile(path, JSON.stringify(value));

    await expect(validateIntegration(repo)).rejects.toThrow(/does not match expected output/);
  });

  it("rejects an omitted canonical-field decision", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-missing-field-"));
    await writeIntegration(repo);
    const path = join(repo, ".pulse/artifacts/integration/mapping-plan.json");
    const value = JSON.parse(await readFile(path, "utf8"));
    value.requirements["TranscriptTurn.language"] = undefined;
    await writeFile(path, JSON.stringify(value));

    await expect(validateIntegration(repo)).rejects.toThrow(/omits canonical fields/);
  });

  it("rejects path examples that do not match the manifest selector", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-path-case-"));
    await writeIntegration(repo);
    const path = join(repo, ".pulse/artifacts/integration/mapping-plan.json");
    const value = JSON.parse(await readFile(path, "utf8"));
    value.sources[0].path_cases[0].object_path = "wrong/synthetic-call/conversation.md";
    await writeFile(path, JSON.stringify(value));

    await expect(validateIntegration(repo)).rejects.toThrow(/contradicts conversation/);
  });

  it("validates multi-call mapper output with mapper correlation", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pw-many-"));
    await writeIntegration(repo);
    const manifestPath = join(repo, ".pulse/artifacts/integration/manifest.json");
    const manifestValue = JSON.parse(await readFile(manifestPath, "utf8"));
    const events = manifestValue.artifacts.find(({ id }: { id: string }) => id === "events");
    events.correlation.call_id = { from: "mapper" };
    manifestValue.mappers["events-trace"].cardinality = "many";
    manifestValue.mappers["events-trace"].expression =
      '[$merge([data.trace,{"call_id":data.call_id}])]';
    await writeFile(manifestPath, JSON.stringify(manifestValue));

    const planPath = join(repo, ".pulse/artifacts/integration/mapping-plan.json");
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    const source = plan.sources.find(({ id }: { id: string }) => id === "events-source");
    source.format.cardinality = "many";
    source.path_cases[0].call_id = undefined;
    await writeFile(planPath, JSON.stringify(plan));

    const casePath = join(
      repo,
      ".pulse/artifacts/integration/fixtures/events-source/complete.json",
    );
    const mappingCase = JSON.parse(await readFile(casePath, "utf8"));
    mappingCase.input._pulse.call_id = null;
    mappingCase.input.data.call_id = "synthetic-call";
    mappingCase.expected["events-trace"] = [mappingCase.expected["events-trace"]];
    await writeFile(casePath, JSON.stringify(mappingCase));

    const result = await validateIntegration(repo);
    expect(result.fragments["events-trace"]).toHaveLength(1);
  });
});
