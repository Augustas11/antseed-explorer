"use client";

import { useEffect, useRef, useState } from "react";

function storageKey(address: string) {
  return `antseed:label:${address.toLowerCase()}`;
}

export default function PrivateLabel({ address }: { address: string }) {
  const [label, setLabel] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(storageKey(address));
    if (stored) setLabel(stored);
  }, [address]);

  useEffect(() => {
    if (editing) {
      setDraft(label ?? "");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing, label]);

  function save() {
    const trimmed = draft.trim();
    if (trimmed) {
      localStorage.setItem(storageKey(address), trimmed);
      setLabel(trimmed);
    } else {
      localStorage.removeItem(storageKey(address));
      setLabel(null);
    }
    setEditing(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") setEditing(false);
  }

  if (!mounted) return null;

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={save}
          placeholder="Add label…"
          maxLength={80}
          className="text-xs bg-panel border border-accent rounded px-1.5 py-0.5 text-ink font-sans w-32 focus:outline-none"
        />
        <button
          onMouseDown={(e) => { e.preventDefault(); save(); }}
          className="text-xs text-accent hover:underline"
        >
          save
        </button>
      </span>
    );
  }

  if (label) {
    return (
      <span className="group inline-flex items-center gap-1">
        <span className="text-xs text-yellow-400 italic">{label}</span>
        <button
          onClick={() => setEditing(true)}
          className="text-[10px] text-muted opacity-0 group-hover:opacity-100 hover:text-ink transition-opacity"
          title="Edit label"
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-[10px] text-muted opacity-0 hover:opacity-100 focus:opacity-100 group-hover:opacity-100 hover:text-ink transition-opacity"
      title="Add private label"
    >
      + label
    </button>
  );
}
