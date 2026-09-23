import { describe, expect, it } from "vitest";
import { validateMappingPlan } from "../src/integration/mappingPlan.js";
import { manifest, mappingPlan } from "./helpers.js";

describe("mapping plan", () => {
  it("requires a confirmed primary source for overlapping canonical fields", () => {
    const plan = mappingPlan();
    plan.sources.push({
      id: "database-transcript",
      producer: { file: "src/database.py", symbol: "save_transcript" },
      artifact_ids: [],
      mapper_ids: [],
      format: {
        decoder: "json",
        cardinality: "one",
        description: "A second valid transcript source not selected for ingestion.",
        variants: [],
        projections: [
          {
            id: "duplicate-turns",
            locator: "/turns",
            canonical_fields: ["Transcript.turns"],
            via: { unmapped: true },
            use: "duplicate_not_selected",
          },
        ],
      },
      path_cases: [],
    });

    expect(() => validateMappingPlan(plan, manifest())).toThrow(/duplicate sources/);

    plan.overlaps.push({
      canonical_fields: ["Transcript.turns"],
      candidates: ["conversation-source", "database-transcript"],
      selected: "conversation-source",
      confirmed: true,
    });
    expect(validateMappingPlan(plan, manifest()).overlaps).toHaveLength(1);
  });

  it("allows call_id from multiple partial CallHeader sources", () => {
    const integration = manifest();
    integration.mappers["conversation-call"] = {
      language: "jsonata",
      input: "text",
      output: "call",
      cardinality: "one",
      expression: '{"call_id":_pulse.call_id,"llm_model":"gemini"}',
    };
    integration.mappers["events-call"] = {
      language: "jsonata",
      input: "json",
      output: "call",
      cardinality: "one",
      expression: '{"call_id":_pulse.call_id,"voice":"nova"}',
    };
    integration.artifacts[0]!.emits.push({ target: "call", mapper: "conversation-call" });
    integration.artifacts[1]!.emits.push({ target: "call", mapper: "events-call" });

    const plan = mappingPlan();
    const conversation = plan.sources.find(({ id }) => id === "conversation-source")!;
    conversation.mapper_ids.push("conversation-call");
    conversation.format.projections.push({
      id: "conversation-header",
      locator: "Markdown header",
      canonical_fields: ["CallHeader.call_id", "CallHeader.llm_model"],
      via: { mapper: "conversation-call" },
      use: "selected",
    });
    const events = plan.sources.find(({ id }) => id === "events-source")!;
    events.mapper_ids.push("events-call");
    events.format.projections.push({
      id: "events-header",
      locator: "/voice",
      canonical_fields: ["CallHeader.call_id", "CallHeader.voice"],
      via: { mapper: "events-call" },
      use: "selected",
    });
    plan.requirements["CallHeader.call_id"] = {
      status: "mapped",
      sources: ["conversation-source", "events-source"],
    };
    plan.requirements["CallHeader.llm_model"] = {
      status: "mapped",
      sources: ["conversation-source"],
    };
    plan.requirements["CallHeader.voice"] = {
      status: "mapped",
      sources: ["events-source"],
    };

    expect(validateMappingPlan(plan, integration).overlaps).toEqual([]);
  });
});
