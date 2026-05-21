"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted select-none"
      title="Polling every 60s"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
      Polling
    </span>
  );
}
