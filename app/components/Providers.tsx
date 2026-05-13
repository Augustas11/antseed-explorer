"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

// ── Theme ────────────────────────────────────────────────────────────────────

export type Theme = "dark" | "dim" | "light";

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: "dark", setTheme: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

// ── Timestamp preference ─────────────────────────────────────────────────────

export type TsFmt = "utc" | "local" | "unix";

interface TsCtx {
  fmt: TsFmt;
  setFmt: (f: TsFmt) => void;
}

const TsContext = createContext<TsCtx>({ fmt: "utc", setFmt: () => {} });

export function useTsFmt() {
  return useContext(TsContext);
}

// ── Combined provider ────────────────────────────────────────────────────────

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return (localStorage.getItem("theme") as Theme) ?? "dark";
}

function getStoredTsFmt(): TsFmt {
  if (typeof window === "undefined") return "utc";
  return (localStorage.getItem("ts-fmt") as TsFmt) ?? "utc";
}

export default function Providers({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [fmt, setFmtState] = useState<TsFmt>("utc");

  useEffect(() => {
    setThemeState(getStoredTheme());
    setFmtState(getStoredTsFmt());
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem("theme", t);
    document.documentElement.className = t === "dark" ? "" : t;
  }, []);

  const setFmt = useCallback((f: TsFmt) => {
    setFmtState(f);
    localStorage.setItem("ts-fmt", f);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <TsContext.Provider value={{ fmt, setFmt }}>
        {children}
      </TsContext.Provider>
    </ThemeContext.Provider>
  );
}
