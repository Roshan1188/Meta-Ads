/**
 * Basic video: a headline over a slideshow of the generated images. Deliberately
 * a template render, not a generative video model — the spec calls for a 15s
 * slideshow and nothing more.
 *
 * Feature-flagged: without SHOTSTACK_API_KEY the whole step is skipped rather
 * than mocked, because a fake MP4 URL is worse than no video at all.
 */

export interface VideoProvider {
  readonly name: string;
  generate(input: VideoInput): Promise<string>;
}

export type VideoInput = { headline: string; imageUrls: string[] };
export type VideoResult = { url: string | null; skipped: boolean; reason?: string };

export const isVideoConfigured = Boolean(process.env.SHOTSTACK_API_KEY);

const CLIP_SECONDS = 5;
const MAX_CLIPS = 3;
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 180_000;

const shotstackProvider: VideoProvider = {
  name: "shotstack",
  generate: async ({ headline, imageUrls }) => {
    const key = process.env.SHOTSTACK_API_KEY;
    if (!key) throw new Error("SHOTSTACK_API_KEY is not set.");

    // Shotstack fetches assets by URL, so data: URIs (our mock images) can't be used.
    const clips = imageUrls
      .filter((url) => url.startsWith("http"))
      .slice(0, MAX_CLIPS)
      .map((url, index) => ({
        asset: { type: "image", src: url },
        start: index * CLIP_SECONDS,
        length: CLIP_SECONDS,
        effect: "zoomIn",
        transition: { in: "fade", out: "fade" },
      }));

    if (clips.length === 0) {
      throw new Error("Video needs at least one hosted image. Generate real images first.");
    }

    const headers = { "x-api-key": key, "Content-Type": "application/json" };
    const edit = {
      timeline: {
        background: "#000000",
        tracks: [
          {
            clips: [
              {
                asset: {
                  type: "title",
                  text: headline,
                  style: "minimal",
                  color: "#ffffff",
                  size: "medium",
                },
                start: 0,
                length: clips.length * CLIP_SECONDS,
                position: "bottom",
              },
            ],
          },
          { clips },
        ],
      },
      output: { format: "mp4", resolution: "sd", aspectRatio: "1:1" },
    };

    const created = await fetch("https://api.shotstack.io/edit/stage/render", {
      method: "POST",
      headers,
      body: JSON.stringify(edit),
    });
    if (!created.ok) {
      throw new Error(`Shotstack rejected the render (${created.status}).`);
    }

    const { response } = (await created.json()) as { response: { id: string } };
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    for (;;) {
      if (Date.now() > deadline) throw new Error("Video render timed out.");
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const polled = await fetch(`https://api.shotstack.io/edit/stage/render/${response.id}`, {
        headers,
      });
      if (!polled.ok) throw new Error(`Shotstack poll failed (${polled.status}).`);

      const { response: status } = (await polled.json()) as {
        response: { status: string; url?: string; error?: string };
      };

      if (status.status === "done" && status.url) return status.url;
      if (status.status === "failed") {
        throw new Error(status.error ?? "Video render failed.");
      }
    }
  },
};

export async function generateVideo(input: VideoInput): Promise<VideoResult> {
  if (!isVideoConfigured) {
    return {
      url: null,
      skipped: true,
      reason: "Video is off. Add SHOTSTACK_API_KEY to .env to enable it.",
    };
  }

  try {
    return { url: await shotstackProvider.generate(input), skipped: false };
  } catch (error) {
    // A failed video must never fail the whole generation — it's the optional step.
    return {
      url: null,
      skipped: true,
      reason: error instanceof Error ? error.message : "Video render failed.",
    };
  }
}
