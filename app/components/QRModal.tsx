"use client";

import { useState, useEffect, useCallback } from "react";
import QRCode from "react-qr-code";

interface Props {
  address: string;
}

export default function QRModal({ address }: Props) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-muted hover:text-ink border border-edge rounded px-1.5 py-0.5"
        aria-label="Show QR code"
        title="Show QR code"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "inline" }}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="3" height="3" />
          <rect x="18" y="14" width="3" height="3" />
          <rect x="14" y="18" width="3" height="3" />
          <rect x="18" y="18" width="3" height="3" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="bg-panel border border-edge rounded-xl p-6 flex flex-col items-center gap-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-ink">Address QR</div>
            <div className="bg-white p-3 rounded-lg">
              <QRCode value={address} size={180} />
            </div>
            <code className="text-xs text-muted font-mono break-all max-w-xs text-center">
              {address}
            </code>
            <button onClick={close} className="btn text-xs">
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
