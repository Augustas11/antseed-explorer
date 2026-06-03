/**
 * Best-effort scrubbing of strings that may flow back to the MCP caller or
 * to stderr. Stripped:
 *   - Absolute Unix and Windows paths ending in common source/config extensions
 *   - IPv4 literals (with optional port)
 *   - IPv6 literals and URLs with hostnames
 *   - secret-like key=value pairs (keeps the variable name, hides the value)
 * Truncated to 300 chars to bound message size.
 */
export function sanitizeMessage(msg: string): string {
  return msg
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, "<url>")
    .replace(
      /(?:\/|[A-Za-z]:\\)[\w./\\\-]+\.(?:ts|tsx|js|mjs|cjs|json|env|yml|yaml|toml|ini)(?::\d+(?::\d+)?)?/gi,
      "<path>",
    )
    .replace(/\[[0-9a-f:]{2,}\](?::\d+)?/gi, "<ip>")
    .replace(/\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]{1,}(?::\d+)?\b/gi, "<ip>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>")
    .replace(
      /\b((?=[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|AUTH))[A-Za-z][A-Za-z0-9_]*)=[^\s,]+/gi,
      "$1=<redacted>",
    )
    .slice(0, 300);
}
