/** Cap the text we send to Claude — most sites repeat themselves after this. */
const MAX_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;

export class ScrapeError extends Error {}

/** Adds https:// when the user typed a bare domain, and rejects anything non-http. */
export function normaliseUrl(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ScrapeError("That doesn't look like a valid website address.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScrapeError("Only http and https addresses are supported.");
  }
  return url.toString();
}

/**
 * Fetches a page and reduces it to readable text. Deliberately dependency-free:
 * an ad platform only needs the visible copy, not a DOM.
 */
export async function fetchSiteText(rawUrl: string): Promise<{ url: string; text: string }> {
  const url = normaliseUrl(rawUrl);

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Some hosts serve a bot challenge to unknown agents.
        "User-Agent":
          "Mozilla/5.0 (compatible; AutoAdsAI/1.0; +https://autoads.ai/bot)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    throw new ScrapeError(
      "Could not reach that website. Check the address, or try again in a moment.",
    );
  }

  if (!res.ok) {
    throw new ScrapeError(`That website returned ${res.status}. Try a different page.`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html")) {
    throw new ScrapeError("That address isn't an HTML page.");
  }

  const text = htmlToText(await res.text());
  if (text.length < 100) {
    throw new ScrapeError(
      "That page has almost no readable text — it may be rendered entirely by JavaScript.",
    );
  }

  return { url, text: text.slice(0, MAX_CHARS) };
}

function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const description =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? "";

  const body = html
    // Script/style/noscript content is never user-visible copy.
    .replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Keep block boundaries so sentences don't run together.
    .replace(/<\/(p|div|li|h[1-6]|br|section|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeEntities([title, description, body].join("\n"))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|[a-z]+);/gi, (match, entity: string) => {
    const named = ENTITIES[entity.toLowerCase()];
    if (named) return named;

    const code = /^#(\d+)$/.exec(entity);
    return code ? String.fromCharCode(Number(code[1])) : match;
  });
}
