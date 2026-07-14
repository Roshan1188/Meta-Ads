/** Client-side POST that surfaces the API's error message rather than a bare status. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!res.ok) {
    throw new Error(payload?.error ?? `Request failed (${res.status}).`);
  }
  if (!payload) throw new Error("The server returned an empty response.");

  return payload;
}
