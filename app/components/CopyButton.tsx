"use client";
import { useState } from "react";

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {}
      }}
      className="text-xs text-muted hover:text-ink border border-edge rounded px-1.5 py-0.5"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}
