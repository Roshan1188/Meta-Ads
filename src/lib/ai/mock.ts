import type { AdCopy, CampaignPlan, Goal, WebsiteAnalysis } from "./schemas";
import { GOAL_TO_META_OBJECTIVE } from "./schemas";

/**
 * MOCK DATA — returned only when the relevant API key is missing, so the app is
 * runnable end to end without spending money. Every function that can fall back
 * to a mock also reports `mocked: true` up to the UI, which labels it clearly.
 * Never let a mock pass silently for real output.
 */

export function mockAnalysis(url: string): WebsiteAnalysis {
  const host = safeHost(url);
  return {
    businessName: host,
    summary: `MOCK ANALYSIS — no ANTHROPIC_API_KEY is set, so ${host} was never actually read. Add the key to .env for real output.`,
    services: ["Example service one", "Example service two", "Example service three"],
    valueProps: ["Example value proposition", "Another differentiator"],
    tone: "Warm and practical",
    location: "Unknown",
    targetCustomer: "An example customer segment.",
  };
}

export function mockCopy(analysis: WebsiteAnalysis): AdCopy {
  return {
    headlines: Array.from(
      { length: 10 },
      (_, i) => `MOCK headline ${i + 1} for ${analysis.businessName}`.slice(0, 40),
    ),
    primaryTexts: Array.from(
      { length: 5 },
      (_, i) =>
        `MOCK primary text ${i + 1}. This is placeholder copy because ANTHROPIC_API_KEY is not set. Add the key to .env to generate real ad copy.`,
    ),
    imagePrompts: Array.from(
      { length: 10 },
      (_, i) => `MOCK image prompt ${i + 1}: a photograph representing ${analysis.services[0]}`,
    ),
  };
}

export function mockPlan(analysis: WebsiteAnalysis, goal: Goal): CampaignPlan {
  return {
    audience: {
      interests: ["Example interest", "Another interest"],
      ageMin: 25,
      ageMax: 55,
      genders: "ALL",
      locations: [analysis.location === "Unknown" ? "India" : analysis.location],
      rationale: "MOCK audience — set ANTHROPIC_API_KEY for a real suggestion.",
    },
    budget: {
      allocations: [
        { adSetName: "Broad", percentage: 60, reason: "MOCK — widest reach." },
        { adSetName: "Interest-targeted", percentage: 40, reason: "MOCK — higher intent." },
      ],
    },
    structure: {
      campaignName: `${analysis.businessName} — ${goal}`,
      objective: GOAL_TO_META_OBJECTIVE[goal] as CampaignPlan["structure"]["objective"],
      adSets: [
        { name: "Broad", audienceNote: "MOCK — no interest narrowing.", adCount: 3 },
        { name: "Interest-targeted", audienceNote: "MOCK — narrowed by interest.", adCount: 3 },
      ],
    },
  };
}

/** A neutral SVG placeholder, inlined so it needs no network and no storage. */
export function mockImages(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
      <rect width="512" height="512" fill="#1e5631"/>
      <text x="50%" y="46%" fill="#ffffff" font-family="sans-serif" font-size="26"
        text-anchor="middle">MOCK IMAGE ${i + 1}</text>
      <text x="50%" y="56%" fill="#c9e0d2" font-family="sans-serif" font-size="15"
        text-anchor="middle">set REPLICATE_API_TOKEN</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  });
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
