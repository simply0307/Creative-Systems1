import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { envValue } from "./config.mjs";
import { storyProviderInput } from "./ai-core.mjs";
import { sourceComparisonSchema, storyEnrichmentResultSchema } from "./enrichment.mjs";

const usage = (response) => ({
  input_tokens: response.usage?.input_tokens ?? null,
  output_tokens: response.usage?.output_tokens ?? null,
  total_tokens: response.usage?.total_tokens ?? null,
  details: response.usage || {},
});

const systemInstruction = "You are an internal research-desk classifier for Reath Digest. Analyze only the supplied source metadata. Do not invent facts, do not write publishable copy, preserve uncertainty and source distinctions, and return only the requested validated structure. Scores use 0-100; confidence uses 0-1.";

export class OpenAIStoryEnrichmentProvider {
  constructor({ client, model, enrichmentVersion }) {
    this.client = client;
    this.name = "openai";
    this.model = model;
    this.enrichmentVersion = enrichmentVersion;
  }

  async enrichStory(context) {
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 2200,
      instructions: systemInstruction,
      input: `Produce internal story-level enrichment from this JSON evidence:\n${JSON.stringify(storyProviderInput(context))}`,
      text: { format: zodTextFormat(storyEnrichmentResultSchema, "reath_story_enrichment") },
    });
    return { output: response.output_parsed, requestId: response.id, modelVersion: response.model || this.model, usage: usage(response) };
  }

  async compareStorySources(context) {
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 2200,
      instructions: systemInstruction,
      input: `Compare the attached source metadata for agreement, differences, primary-source claims, disputes, unknowns, and material development. Cite source_item_ids from the supplied evidence only:\n${JSON.stringify(storyProviderInput(context))}`,
      text: { format: zodTextFormat(sourceComparisonSchema, "reath_source_comparison") },
    });
    return { output: response.output_parsed, requestId: response.id, modelVersion: response.model || this.model, usage: usage(response) };
  }
}

export const createStoryEnrichmentProvider = (config, { client = null, env = process.env } = {}) => {
  if (!config.aiEnabled) return { provider: null, capability: { status: "disabled", provider: config.aiProvider, model: config.aiModel } };
  if (config.aiProvider !== "openai") return { provider: null, capability: { status: "unavailable", reason: "unsupported_provider", provider: config.aiProvider, model: config.aiModel } };
  const apiKey = envValue("OPENAI_API_KEY", env);
  if (!client && !apiKey) return { provider: null, capability: { status: "unavailable", reason: "missing_server_credentials", provider: config.aiProvider, model: config.aiModel } };
  const openai = client || new OpenAI({
    apiKey,
    baseURL: envValue("OPENAI_BASE_URL", env) || undefined,
    timeout: config.aiTimeoutMs,
    maxRetries: 0,
  });
  return {
    provider: new OpenAIStoryEnrichmentProvider({ client: openai, model: config.aiModel, enrichmentVersion: config.aiEnrichmentVersion }),
    capability: { status: "available", provider: config.aiProvider, model: config.aiModel, maxStoriesPerRun: config.aiMaxStoriesPerRun },
  };
};
