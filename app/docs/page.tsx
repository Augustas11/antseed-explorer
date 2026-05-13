"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

export default function DocsPage() {
  return (
    <div style={{ margin: "-2rem -1.5rem" }}>
      <ApiReferenceReact
        configuration={{
          url: "/api/openapi.json",
          theme: "default",
        }}
      />
    </div>
  );
}
