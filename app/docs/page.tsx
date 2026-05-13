"use client";

import { useEffect, useRef } from "react";

export default function DocsPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (document.getElementById("scalar-init")) return;

    // Scalar's drop-in script reads config from a <script id="api-reference">
    // element with data attributes, then renders into the page.
    const initScript = document.createElement("script");
    initScript.id = "api-reference";
    initScript.type = "application/json";
    initScript.setAttribute("data-url", "/api/openapi.json");
    containerRef.current.appendChild(initScript);

    const cdnScript = document.createElement("script");
    cdnScript.id = "scalar-init";
    cdnScript.src = "https://cdn.jsdelivr.net/npm/@scalar/api-reference";
    cdnScript.async = true;
    document.body.appendChild(cdnScript);

    return () => {
      cdnScript.remove();
      initScript.remove();
    };
  }, []);

  return <div ref={containerRef} style={{ margin: "-2rem -1.5rem" }} />;
}
