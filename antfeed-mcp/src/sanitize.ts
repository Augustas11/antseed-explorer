/**
 * Best-effort scrubbing of strings that may flow back to the MCP caller or
 * to stderr. Stripped:
 *   - Absolute Unix and Windows paths ending in common source/config extensions
 *   - IPv4 literals (with optional port)
 *   - UPPER_CASE_VAR=value pairs (keeps the variable name, hides the value)
 * Truncated to 300 chars to bound message size.
 */
export function sanitizeMessage(msg: string): string {
  return msg
    .replace(
      /(?:\/|[A-Za-z]:\\)[\w./\\\-]+\.(?:ts|tsx|js|mjs|cjs|json|env|yml|yaml|toml|ini)(?::\d+(?::\d+)?)?/gi,
      "<path>",
    )
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>")
    .replace(/([A-Z][A-Z0-9_]{2,})=[^\s,]+/g, "$1=<redacted>")
    .slice(0, 300);
}
