"use client";

import { useEffect } from "react";

export default function DocsPage() {
  useEffect(() => {
    const existing = document.getElementById("scalar-script");
    if (existing) return;
    const script = document.createElement("script");
    script.id = "scalar-script";
    script.src = "https://cdn.jsdelivr.net/npm/@scalar/api-reference";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  return (
    <div style={{ margin: "-2rem -1.5rem" }}>
      {/* @ts-expect-error — Scalar web component */}
      <api-reference
        spec-url="/api/openapi.json"
        theme="default"
      />
    </div>
  );
}
