export type ModelTag =
  | "vision"
  | "coding"
  | "reasoning"
  | "agents"
  | "embedding"
  | "audio"
  | "open-source"
  | "premium"
  | "free";

const RULES: Array<{ tag: ModelTag; pattern: RegExp }> = [
  {
    tag: "vision",
    pattern: /vision|[-/]vl\b|\bvl[-/]|llava|qvq|pixtral|minicpm-v/i,
  },
  {
    tag: "coding",
    // \bcode\b avoids false-positive on "decode"; coder/starcoder/codestral matched separately
    pattern: /\bcode\b|\bcoder\b|starcoder|codestral/i,
  },
  {
    tag: "reasoning",
    // \bo[13]\b matches o1/o3 as whole tokens; \br[12]\b matches -r1/-r2
    pattern: /reasoning|\br[12]\b|qwq|deepseek-r\d?|\bo[13]\b|thinker|thinking/i,
  },
  {
    tag: "agents",
    // Word-boundary matching prevents false positives like "protocol" or "toolbench"
    pattern: /\bagent\b|\bfunction\b|\btool\b/i,
  },
  {
    tag: "embedding",
    pattern: /\bembed\b|bge-|(?:^|[-/])e5-|nomic-embed|jina-embed/i,
  },
  {
    tag: "audio",
    pattern: /audio|\bwhisper\b|\btts\b|\bspeech\b/i,
  },
  {
    tag: "open-source",
    pattern: /\bllama\b|mistral|qwen|\bgemma\b|\bphi\b|deepseek|mixtral|hermes|\bsolar\b|\bnous\b|dolphin|\borca\b|\bfalcon\b/i,
  },
  {
    tag: "premium",
    // o1/o3 are OpenAI proprietary models; claude/gpt-4/gemini/grok are commercial
    pattern: /\bclaude\b|gpt-4|gemini|\bgrok\b|\bo[13]\b/i,
  },
];

/**
 * Returns capability tags inferred from a model name.
 * The `free` tag is NOT derived here — apply it at render time when
 * both input and output prices are zero.
 */
export function getModelTags(name: string): ModelTag[] {
  const tags: ModelTag[] = [];
  for (const { tag, pattern } of RULES) {
    if (pattern.test(name)) tags.push(tag);
  }
  return tags;
}
