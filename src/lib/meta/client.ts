import "server-only";

/**
 * A thin, typed Graph API client.
 *
 * We deliberately do NOT use `facebook-nodejs-business-sdk`: it ships no
 * TypeScript definitions and no @types package exists, so every Meta call would
 * be `any` — precisely where a wrong field name costs real ad spend. The Marketing
 * API is a plain REST surface, so a typed fetch wrapper is both safer and smaller.
 */

export const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 800;

/** Meta error codes worth retrying — transient or throttling, not our fault. */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 341, 613]);

type GraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
};

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }

  /** True when re-connecting the Facebook account is the fix. */
  get isAuthError() {
    return this.code === 190 || this.code === 102 || this.code === 10;
  }
}

/**
 * Meta's raw `message` is written for API developers ("Invalid parameter"), not
 * for the person who has to fix it. `error_user_msg` is the human one when present.
 */
function toReadableError(body: GraphErrorBody, status: number): MetaApiError {
  const error = body.error;
  if (!error) {
    return new MetaApiError(`Meta returned HTTP ${status} with no error body.`);
  }

  const known = explain(error.code, error.error_subcode);
  const message =
    known ??
    error.error_user_msg ??
    error.error_user_title ??
    error.message ??
    `Meta rejected the request (HTTP ${status}).`;

  return new MetaApiError(message, error.code, error.error_subcode, error.fbtrace_id);
}

function explain(code?: number, subcode?: number): string | undefined {
  if (code === 190) {
    return "Your Facebook connection has expired. Reconnect it in Settings.";
  }
  if (code === 200 || code === 10) {
    return "Your Facebook account doesn't have permission to manage ads on this ad account. Ask the account owner to grant you an Advertiser or Admin role.";
  }
  if (code === 100 && subcode === 1487194) {
    return "The daily budget is below Meta's minimum for this ad account.";
  }
  if (code === 100) {
    return "Meta rejected one of the campaign fields. This is usually the targeting spec or the budget.";
  }
  if (code === 4 || code === 17 || code === 613) {
    return "Meta is rate-limiting this ad account. Wait a few minutes and try again.";
  }
  if (code === 2) {
    return "Meta had a temporary server error. Try again shortly.";
  }
  return undefined;
}

async function request<T>(
  path: string,
  init: RequestInit,
  attempt = 1,
): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, init);

  if (res.ok) return (await res.json()) as T;

  const body = (await res.json().catch(() => ({}))) as GraphErrorBody;
  const error = toReadableError(body, res.status);

  const retryable =
    (error.code !== undefined && RETRYABLE_CODES.has(error.code)) || res.status >= 500;

  if (retryable && attempt < MAX_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, BASE_BACKOFF_MS * 2 ** (attempt - 1)));
    return request<T>(path, init, attempt + 1);
  }

  throw error;
}

export async function graphGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string | undefined> = {},
): Promise<T> {
  const query = new URLSearchParams();
  // The OAuth token-exchange endpoints authenticate with app credentials and
  // reject an empty access_token, so only send it when we actually have one.
  if (accessToken) query.set("access_token", accessToken);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }

  return request<T>(`${path}?${query}`, { method: "GET" });
}

/**
 * The Marketing API takes form-encoded bodies, and nested values (targeting,
 * object_story_spec) must be JSON-stringified into a single field.
 */
export async function graphPost<T>(
  path: string,
  accessToken: string,
  fields: Record<string, unknown>,
): Promise<T> {
  const form = new URLSearchParams({ access_token: accessToken });

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }

  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
}

/** Paged edges (`/act_x/campaigns` etc.) — we only ever need the first page here. */
export type Paged<T> = { data: T[]; paging?: { cursors?: { after?: string } } };
