"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [live, setLive] = useState(false);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("open", () => setLive(true));
    es.addEventListener("message", () => {
      router.refresh();
    });
    es.addEventListener("error", () => setLive(false));
    return () => es.close();
  }, [router]);

  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted select-none"
      title={live ? "Live updates via SSE" : "Polling every 60s"}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${live ? "bg-green-500 animate-pulse" : "bg-gray-500"}`}
      />
      {live ? <span className="text-green-500">Live</span> : "Polling"}
    </span>
  );
}
