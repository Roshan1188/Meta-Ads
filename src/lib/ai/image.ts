import { mockImages } from "./mock";

/**
 * The only image contract the rest of the app knows about. Swapping Replicate for
 * OpenAI Images, Fal, or a self-hosted SDXL means adding a provider below and
 * changing `pickProvider` — no feature code changes.
 */
export interface ImageProvider {
  readonly name: string;
  generate(prompts: string[]): Promise<string[]>;
}

export type ImageResult = { images: string[]; mocked: boolean; provider: string };

const REPLICATE_MODEL = "black-forest-labs/flux-schnell";
const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 90_000;

const mockProvider: ImageProvider = {
  name: "mock",
  generate: async (prompts) => mockImages(prompts.length),
};

/**
 * Replicate runs predictions asynchronously: create, then poll until terminal.
 * Prompts run concurrently — 10 sequential calls would take minutes.
 */
const replicateProvider: ImageProvider = {
  name: "replicate",
  generate: (prompts) => Promise.all(prompts.map(runReplicatePrediction)),
};

async function runReplicatePrediction(prompt: string): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set.");

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const created = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { prompt, aspect_ratio: "1:1", output_format: "webp", num_outputs: 1 },
    }),
  });

  if (!created.ok) {
    throw new Error(`Replicate rejected the request (${created.status}): ${await created.text()}`);
  }

  let prediction = (await created.json()) as ReplicatePrediction;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (prediction.status === "starting" || prediction.status === "processing") {
    if (Date.now() > deadline) throw new Error("Image generation timed out.");
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const polled = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers,
    });
    if (!polled.ok) throw new Error(`Replicate poll failed (${polled.status}).`);
    prediction = (await polled.json()) as ReplicatePrediction;
  }

  if (prediction.status !== "succeeded") {
    throw new Error(prediction.error ?? `Image generation ${prediction.status}.`);
  }

  // Flux returns an array; some models return a bare string.
  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!url) throw new Error("Replicate returned no image.");
  return url;
}

type ReplicatePrediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[];
  error?: string;
};

function pickProvider(): ImageProvider {
  return process.env.REPLICATE_API_TOKEN ? replicateProvider : mockProvider;
}

export async function generateImages(prompts: string[]): Promise<ImageResult> {
  const provider = pickProvider();
  return {
    images: await provider.generate(prompts),
    mocked: provider.name === "mock",
    provider: provider.name,
  };
}
