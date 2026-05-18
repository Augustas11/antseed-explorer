// Canonical service grouping for the /providers filter dropdown.
//
// Many providers advertise the same model under slightly different strings —
// "Claude Opus 4.6" / "claude-opus-4.6" / "claude-opus-4-6". This lib groups
// them under one canonical display name so the dropdown stays scannable,
// while preserving the raw strings so the underlying filter query still
// matches every advertised alias.
//
// Real variant suffixes (-fast, -8b, -mini, etc.) stay as separate canonical
// entries because they indicate a meaningfully different model.

// Provider-internal labels that leak through but don't represent a real
// variant — strip from the canonical key.
const COSMETIC_SUFFIXES = ["venicestats", "sale", "promo"];

// Suffixes that indicate a real model variant. Mapped to the parenthetical
// shown on the display name (e.g. "Claude Opus 4.6 (fast)").
const VARIANT_SUFFIXES: Record<string, string> = {
  fast: "fast",
  mini: "mini",
  flash: "flash",
  large: "large",
  thinking: "thinking",
  "8b": "8B",
  "13b": "13B",
  "70b": "70B",
};

// One-off mappings for service strings the rule pipeline doesn't normalize
// cleanly. Keys are lowercased raw inputs.
const RAW_OVERRIDES: Record<string, string> = {
  "deepseek-ai/deepseek-v3.1": "DeepSeek V3.1",
};

// Pretty display names for known normalized keys. Falls back to title-cased
// reconstruction for unknown keys, so adding entries here only improves
// existing renderings — it never breaks new models.
const KNOWN_MODELS: Record<string, string> = {
  "claude-opus-4-5": "Claude Opus 4.5",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-sonnet-4": "Claude Sonnet 4",
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "gpt-5-4": "GPT 5.4",
  "gpt-5-5": "GPT 5.5",
  "grok-4-3": "Grok 4.3",
  "glm-5-1": "GLM 5.1",
  "kimi-k2-5": "Kimi K2.5",
  "kimi-k2-6": "Kimi K2.6",
  "codex-5-5": "Codex 5.5",
  "deepseek-r1": "DeepSeek R1",
  "deepseek-chat": "DeepSeek Chat",
  "deepseek-reasoner": "DeepSeek Reasoner",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
};

function stripCosmeticSuffix(key: string): string {
  for (const suf of COSMETIC_SUFFIXES) {
    if (key.endsWith(`-${suf}`)) return key.slice(0, -(suf.length + 1));
  }
  return key;
}

function detectVariant(key: string): { base: string; variant: string | null } {
  for (const [suf, label] of Object.entries(VARIANT_SUFFIXES)) {
    if (key.endsWith(`-${suf}`)) {
      return { base: key.slice(0, -(suf.length + 1)), variant: label };
    }
  }
  return { base: key, variant: null };
}

function prettifyKey(base: string): string {
  if (KNOWN_MODELS[base]) return KNOWN_MODELS[base];
  const titled = base
    .split("-")
    .map((tok) => (tok.length ? tok.charAt(0).toUpperCase() + tok.slice(1) : tok))
    .join(" ");
  // Restore version-style dots: "Claude Opus 4 6" → "Claude Opus 4.6"
  return titled.replace(/(\d+) (\d+)/g, "$1.$2");
}

export interface CanonicalService {
  key: string;
  display: string;
}

export function canonicalize(raw: string): CanonicalService {
  const lower = raw.toLowerCase().trim();
  if (RAW_OVERRIDES[lower]) {
    return { key: lower, display: RAW_OVERRIDES[lower] };
  }

  let key = lower.replace(/\s+/g, "-").replace(/\./g, "-");
  key = stripCosmeticSuffix(key);
  key = key.replace(/-+/g, "-").replace(/^-|-$/g, "");

  // If the full normalized key is a registered model name, use it verbatim
  // and skip variant decomposition. Otherwise a name that legitimately ends
  // in a known variant suffix ("DeepSeek V4 Flash") gets miscategorized.
  if (KNOWN_MODELS[key]) {
    return { key, display: KNOWN_MODELS[key] };
  }

  const { base, variant } = detectVariant(key);
  let display = prettifyKey(base);
  if (variant) display = `${display} (${variant})`;

  return { key, display };
}

// Group an array of raw service strings into canonical buckets.
// Returned entries are sorted by display name.
export interface ServiceGroup {
  key: string;
  display: string;
  aliases: string[];
}

export function groupServices(raws: string[]): ServiceGroup[] {
  const byKey = new Map<string, ServiceGroup>();
  for (const raw of raws) {
    const { key, display } = canonicalize(raw);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.aliases.includes(raw)) existing.aliases.push(raw);
    } else {
      byKey.set(key, { key, display, aliases: [raw] });
    }
  }
  return [...byKey.values()].sort((a, b) => a.display.localeCompare(b.display));
}
