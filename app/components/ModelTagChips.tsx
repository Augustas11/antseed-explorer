import type { ModelTag } from "@/lib/modelTags";

interface Props {
  tags: ModelTag[];
}

const TAG_CLASS: Record<ModelTag, string> = {
  vision: "badge-good",
  reasoning: "badge-good",
  agents: "badge-good",
  premium: "badge-warn",
  coding: "badge-muted",
  embedding: "badge-muted",
  audio: "badge-muted",
  "open-source": "badge-muted",
  free: "badge-muted",
};

export default function ModelTagChips({ tags }: Props) {
  if (!tags || tags.length === 0) return null;
  const visible = tags.slice(0, 3);
  const overflow = tags.length - visible.length;

  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {visible.map((t) => (
        <span
          key={t}
          className={`badge ${TAG_CLASS[t] ?? "badge-muted"} text-[10px] py-0`}
          title={t}
        >
          {t}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="badge badge-muted text-[10px] py-0 hidden sm:inline-flex"
          title={tags.slice(3).join(", ")}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
