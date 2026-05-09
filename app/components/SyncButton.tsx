"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function SyncButton() {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function run() {
    setStatus("Syncing…");
    try {
      const res = await fetch("/api/sync?force=1", { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        setStatus(`error: ${json.error?.slice(0, 60) || "failed"}`);
        return;
      }
      if (json.skipped) {
        setStatus(`up to date (${json.skipped})`);
      } else {
        setStatus(
          `+${json.eventsAdded} events, ${json.buyersTouched} buyers, head ${json.toBlock}`,
        );
      }
      startTransition(() => router.refresh());
    } catch (e: any) {
      setStatus(`error: ${e?.message || "unknown"}`);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {status && (
        <span className="text-xs text-muted hidden md:inline">{status}</span>
      )}
      <button onClick={run} disabled={pending} className="btn-accent">
        {pending ? "Refreshing…" : "Sync now"}
      </button>
    </div>
  );
}
