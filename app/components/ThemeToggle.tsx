"use client";

import { useTheme, type Theme } from "./Providers";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "dim", label: "Dim" },
  { value: "light", label: "Light" },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center rounded border border-edge overflow-hidden text-xs">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          className={`px-2 py-1 whitespace-nowrap transition-colors ${
            theme === opt.value
              ? "bg-edge text-ink"
              : "bg-panel text-muted hover:text-ink"
          }`}
          aria-pressed={theme === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
