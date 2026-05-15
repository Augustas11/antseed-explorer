export class ResponseTooLargeError extends Error {
  code = "RESPONSE_TOO_LARGE" as const;
  constructor(maxBytes: number, observed: number) {
    super(`response body exceeded ${maxBytes} bytes (observed >= ${observed})`);
    this.name = "ResponseTooLargeError";
  }
}

/**
 * Read a JSON body with a hard byte ceiling. Streams the body into chunks and
 * aborts the read if the cap is exceeded — protects against a malicious or
 * compromised endpoint returning multi-GB responses that would crash the host.
 */
export async function readJsonCapped(res: Response, maxBytes: number): Promise<unknown> {
  const cl = Number(res.headers.get("content-length") ?? 0);
  if (cl && cl > maxBytes) throw new ResponseTooLargeError(maxBytes, cl);

  const reader = res.body?.getReader();
  if (!reader) {
    // Some test fixtures (e.g. constructed `Response` with no stream) — fall back to .json().
    return res.json();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // best-effort
      }
      throw new ResponseTooLargeError(maxBytes, total);
    }
    chunks.push(value);
  }

  const buf = concat(chunks, total);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return JSON.parse(text);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
