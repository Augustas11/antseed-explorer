import { createHash } from "node:crypto";

export const API_KEY_HASH_PREFIX = "sha256:";

export function hashApiKey(raw: string): string {
  return `${API_KEY_HASH_PREFIX}${createHash("sha256").update(raw).digest("hex")}`;
}

export function hashIdentifier(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function isApiKeyShape(raw: string): boolean {
  return /^[0-9a-f]{64}$/i.test(raw);
}
