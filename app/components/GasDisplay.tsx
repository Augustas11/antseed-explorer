"use client";

import { useState, useEffect } from "react";

export default function GasDisplay() {
  const [gwei, setGwei] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGas() {
      try {
        const res = await fetch("/api/gas");
        if (!res.ok) return;
        const data = await res.json();
        setGwei(data.gwei ?? null);
      } catch {}
    }

    fetchGas();
    const id = setInterval(fetchGas, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!gwei) return null;

  return (
    <span className="text-xs text-muted flex items-center gap-1" title="Base gas price">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 22V8a2 2 0 012-2h10a2 2 0 012 2v14" />
        <path d="M18 8l3 3v11" />
        <path d="M7 14h6" />
        <path d="M7 10h6" />
      </svg>
      {gwei} Gwei
    </span>
  );
}
