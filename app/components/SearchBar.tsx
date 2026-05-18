"use client";
import { useRouter } from "next/navigation";
import { useRef } from "react";

export default function SearchBar() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = inputRef.current?.value.trim() ?? "";
    if (q) router.push("/search?q=" + encodeURIComponent(q));
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        placeholder="0x address…"
        className="min-w-0 flex-1 bg-panel border border-edge rounded px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent/60 md:w-44"
      />
      <button type="submit" className="btn text-xs py-1.5 px-2">
        →
      </button>
    </form>
  );
}
