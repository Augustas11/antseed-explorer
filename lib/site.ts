import { headers } from "next/headers";

const FALLBACK_SITE_ORIGIN = "https://www.antfeed.org";

export async function getSiteOrigin(): Promise<string> {
  const envOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (envOrigin) return envOrigin;

  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (!host) return FALLBACK_SITE_ORIGIN;

  const protocol =
    headerStore.get("x-forwarded-proto") ??
    (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");

  return normalizeOrigin(`${protocol}://${host}`) ?? FALLBACK_SITE_ORIGIN;
}

export function siteUrl(origin: string, path: string): string {
  return new URL(path, ensureTrailingSlash(origin)).toString();
}

function normalizeOrigin(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return null;
  }
}

function ensureTrailingSlash(origin: string): string {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
