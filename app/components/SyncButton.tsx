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
      let secret = window.localStorage.getItem("antfeed_sync_secret") || "";
      if (!secret) {
        secret = window.prompt("Sync secret")?.trim() || "";
        if (secret) window.localStorage.setItem("antfeed_sync_secret", secret);
      }
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
      });
      if (!res.ok && res.headers.get("content-type")?.includes("application/json") === false) {
        setStatus(`error: HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      if (!json.ok) {
        if (res.status === 401) window.localStorage.removeItem("antfeed_sync_secret");
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
