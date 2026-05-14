"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

interface SparklineProps {
  data: { x: string; y: number }[];
  color?: string;
}

// 30d trend line for hero cards. Intentionally axis-less and gridless —
// its only job is to give a shape signal next to the headline number.
export default function Sparkline({
  data,
  color = "var(--color-accent)",
}: SparklineProps) {
  if (!data || data.length === 0) {
    return <div className="h-8" />;
  }
  return (
    <div className="h-8 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
          <Area
            type="monotone"
            dataKey="y"
            stroke={color}
            fill={color}
            fillOpacity={0.18}
            strokeWidth={1.5}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
