export type LabId =
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "meta"
  | "mistral"
  | "xai"
  | "alibaba"
  | "microsoft"
  | "generic";

export interface Lab {
  id: LabId;
  name: string;
  logo: string;
}

const LABS: Record<LabId, Lab> = {
  anthropic: { id: "anthropic", name: "Anthropic", logo: "anthropic.svg" },
  openai: { id: "openai", name: "OpenAI", logo: "openai.svg" },
  google: { id: "google", name: "Google", logo: "google.svg" },
  deepseek: { id: "deepseek", name: "DeepSeek", logo: "deepseek.svg" },
  meta: { id: "meta", name: "Meta", logo: "meta.svg" },
  mistral: { id: "mistral", name: "Mistral", logo: "mistral.svg" },
  xai: { id: "xai", name: "xAI", logo: "xai.svg" },
  alibaba: { id: "alibaba", name: "Alibaba", logo: "alibaba.svg" },
  microsoft: { id: "microsoft", name: "Microsoft", logo: "microsoft.svg" },
  generic: { id: "generic", name: "Other lab", logo: "generic.svg" },
};

const RULES: Array<{ id: LabId; pattern: RegExp }> = [
  { id: "anthropic", pattern: /\bclaude\b|anthropic/i },
  { id: "openai", pattern: /\bgpt\b|openai|\bo[134]\b|chatgpt/i },
  { id: "google", pattern: /\bgemini\b|\bgemma\b|palm|google/i },
  { id: "deepseek", pattern: /deepseek/i },
  { id: "meta", pattern: /\bllama\b|\bmeta\b/i },
  { id: "mistral", pattern: /\bmistral\b|mixtral|codestral|pixtral/i },
  { id: "xai", pattern: /\bgrok\b|\bxai\b|x\.ai/i },
  { id: "alibaba", pattern: /\bqwen\b|alibaba|tongyi/i },
  { id: "microsoft", pattern: /\bphi\b|microsoft|azure/i },
];

export function getLabForModel(modelName: string): Lab {
  for (const rule of RULES) {
    if (rule.pattern.test(modelName)) return LABS[rule.id];
  }
  return LABS.generic;
}
