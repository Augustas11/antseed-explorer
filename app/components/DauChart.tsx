"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";

// ── Palette: matches chartTheme in Charts.tsx ──────────────────
const axis = "#8a8f9c";
const grid = "#1f2230";
const barExisting = "#5fb4d8"; // muted blue — base layer
const barNew = "#7cf2c8";      // accent green — top layer

// ── Range config ───────────────────────────────────────────────
type Range = "7d" | "30d" | "90d" | "all";

const RANGES: { label: string; value: Range }[] = [
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "90d", value: "90d" },
  { label: "All", value: "all" },
];

function getDates(range: Range): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (range === "7d") from.setUTCDate(from.getUTCDate() - 6);
  else if (range === "30d") from.setUTCDate(from.getUTCDate() - 29);
  else if (range === "90d") from.setUTCDate(from.getUTCDate() - 89);
  else from.setUTCFullYear(2020, 0, 1); // far past — API returns all rows
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

// ── Data row ───────────────────────────────────────────────────
interface DauRow {
  day: string;
  new: number;
  existing: number;
  total: number;
  dau_buyers: number;
  dau_sellers: number;
}

// ── Short date formatter: "Apr 9", "May 14" ────────────────────
function fmtShortDate(iso: string): string {
  // iso is "YYYY-MM-DD"
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Custom tooltip ─────────────────────────────────────────────
function DauTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;

  // payload[0] = existing, payload[1] = new (order matches Bar render order)
  const existingVal =
    (payload.find((p) => p.dataKey === "existing")?.value as number) ?? 0;
  const newVal =
    (payload.find((p) => p.dataKey === "new")?.value as number) ?? 0;
  const total = existingVal + newVal;
  const dateLabel = fmtShortDate(label as string);

  return (
    <div
      style={{
        background: "#12141a",
        border: "1px solid #1f2230",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        color: "#e7e9ee",
        lineHeight: 1.6,
      }}
    >
      <span style={{ color: "#8a8f9c" }}>{dateLabel}</span>
      {" · "}
      <span style={{ color: "#e7e9ee", fontWeight: 600 }}>
        {total.toLocaleString()} active
      </span>
      <span style={{ color: "#8a8f9c" }}>
        {" "}({newVal.toLocaleString()} new, {existingVal.toLocaleString()} existing)
      </span>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────
function ChartSkeleton() {
  return (
    <div className="h-[220px] flex items-end gap-1 px-2 pb-6 animate-pulse">
      {Array.from({ length: 14 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-edge"
          style={{ height: `${30 + Math.sin(i * 0.7) * 25 + 20}%` }}
        />
      ))}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="h-[220px] flex items-center justify-center text-sm text-muted">
      no activity in this range
    </div>
  );
}

// ── Error state ────────────────────────────────────────────────
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="h-[220px] flex items-center justify-center text-sm text-muted">
      couldn't load DAU —{" "}
      <button
        onClick={onRetry}
        className="text-accent hover:underline underline-offset-2 ml-1"
      >
        retry
      </button>
    </div>
  );
}

// ── Range pill control ─────────────────────────────────────────
function RangePills({
  current,
  onChange,
}: {
  current: Range;
  onChange: (r: Range) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {RANGES.map(({ label, value }) => {
        const isActive = current === value;
        return (
          <button
            key={value}
            onClick={() => onChange(value)}
            className={`pill text-xs transition-colors ${
              isActive
                ? "bg-accent/20 text-accent border-accent/40"
                : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────
export function DauChart() {
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<DauRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async (r: Range) => {
    setLoading(true);
    setError(false);
    try {
      const { from, to } = getDates(r);
      const res = await fetch(
        `/api/metrics/dau?from=${from}&to=${to}&granularity=day`,
        { cache: "default" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows: DauRow[] = await res.json();
      setData(rows);
    } catch {
      setError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  const handleRangeChange = useCallback(
    (r: Range) => {
      setRange(r);
      // fetchData is called by the useEffect above when range changes
    },
    [],
  );

  // Tick thinning for X axis — too many labels crowd on mobile
  const tickFormatter = useCallback(
    (val: string) => fmtShortDate(val),
    [],
  );

  const interval = useMemo(() => {
    if (!data) return "preserveStartEnd";
    const len = data.length;
    if (len <= 14) return 0;
    if (len <= 35) return 3;
    return 6;
  }, [data]);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-medium">Daily active users</h2>
        <RangePills current={range} onChange={handleRangeChange} />
      </div>

      {loading ? (
        <ChartSkeleton />
      ) : error ? (
        <ErrorState onRetry={() => fetchData(range)} />
      ) : !data || data.length === 0 ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={grid} />
            <XAxis
              dataKey="day"
              stroke={axis}
              fontSize={11}
              tickFormatter={tickFormatter}
              interval={interval}
              minTickGap={40}
            />
            <YAxis
              stroke={axis}
              fontSize={11}
              allowDecimals={false}
              label={{
                value: "active users",
                angle: -90,
                position: "insideLeft",
                offset: 10,
                style: { fill: axis, fontSize: 10 },
              }}
              width={72}
            />
            <Tooltip
              content={<DauTooltip />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value) =>
                value === "existing" ? "Existing users" : "New users"
              }
            />
            {/* existing rendered first = bottom of stack */}
            <Bar
              stackId="dau"
              dataKey="existing"
              name="existing"
              fill={barExisting}
              radius={[0, 0, 2, 2]}
            />
            {/* new rendered second = top of stack */}
            <Bar
              stackId="dau"
              dataKey="new"
              name="new"
              fill={barNew}
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
