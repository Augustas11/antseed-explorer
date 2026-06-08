"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompact } from "@/lib/format";

const chartTheme = {
  axis: "#8a8f9c",
  grid: "#1f2230",
  bar: "#7cf2c8",
  bar2: "#f5b656",
  bar3: "#5fb4d8",
};

export function VolumeChart({
  data,
}: {
  data: { day: string; volume: number; sessions: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="day" stroke={chartTheme.axis} fontSize={11} />
        <YAxis stroke={chartTheme.axis} fontSize={11} />
        <Tooltip
          contentStyle={{
            background: "#12141a",
            border: "1px solid #1f2230",
            borderRadius: 8,
          }}
        />
        <Bar dataKey="volume" name="USDC settled" fill={chartTheme.bar} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ActiveBuyersChart({
  data,
}: {
  data: { day: string; active_buyers: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="day" stroke={chartTheme.axis} fontSize={11} />
        <YAxis stroke={chartTheme.axis} fontSize={11} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: "#12141a",
            border: "1px solid #1f2230",
            borderRadius: 8,
          }}
        />
        <Line
          type="monotone"
          dataKey="active_buyers"
          name="Active buyers"
          stroke={chartTheme.bar2}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TokensChart({
  data,
}: {
  data: { day: string; in_tokens: number; out_tokens: number; total_tokens: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="day" stroke={chartTheme.axis} fontSize={11} />
        <YAxis
          stroke={chartTheme.axis}
          fontSize={11}
          tickFormatter={(v) => fmtCompact(v)}
          width={48}
        />
        <Tooltip
          contentStyle={{
            background: "#12141a",
            border: "1px solid #1f2230",
            borderRadius: 8,
          }}
          formatter={(value: number, name: string) => [fmtCompact(value), name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          stackId="tokens"
          dataKey="in_tokens"
          name="Input"
          fill={chartTheme.bar3}
        />
        <Bar
          stackId="tokens"
          dataKey="out_tokens"
          name="Output"
          fill={chartTheme.bar}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ActivityChart({
  data,
}: {
  data: { bucket: string; volume: number; sessions: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="bucket" stroke={chartTheme.axis} fontSize={11} />
        <YAxis yAxisId="left" stroke={chartTheme.axis} fontSize={11} />
        <YAxis
          yAxisId="right"
          orientation="right"
          stroke={chartTheme.axis}
          fontSize={11}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "#12141a",
            border: "1px solid #1f2230",
            borderRadius: 8,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          yAxisId="left"
          dataKey="volume"
          name="USDC settled"
          fill={chartTheme.bar}
        />
        <Bar
          yAxisId="right"
          dataKey="sessions"
          name="Sessions"
          fill={chartTheme.bar2}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function EpochRevenueChart({
  data,
}: {
  data: { label: string; volume: number; sessions: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="label" stroke={chartTheme.axis} fontSize={11} />
        <YAxis stroke={chartTheme.axis} fontSize={11} />
        <Tooltip
          contentStyle={{
            background: "#12141a",
            border: "1px solid #1f2230",
            borderRadius: 8,
          }}
        />
        <Bar dataKey="volume" name="USDC settled" fill={chartTheme.bar2} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AntsSupplyChart({
  data,
}: {
  data: {
    name: string;
    minted?: number;
    available?: number;
    claimed?: number;
    locked?: number;
    unclaimed?: number;
  }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis
          type="number"
          stroke={chartTheme.axis}
          fontSize={11}
          tickFormatter={(v) => fmtCompact(v)}
        />
        <YAxis type="category" dataKey="name" stroke={chartTheme.axis} fontSize={11} width={92} />
        <Tooltip
          contentStyle={{
            background: "#12141a",
            border: "1px solid #1f2230",
            borderRadius: 8,
          }}
          formatter={(value: number, name: string) => [fmtCompact(value), name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar stackId="supply" dataKey="minted" name="Minted" fill={chartTheme.bar} />
        <Bar stackId="supply" dataKey="available" name="Available" fill={chartTheme.grid} />
        <Bar stackId="claim" dataKey="claimed" name="Claimed liquid" fill={chartTheme.bar3} />
        <Bar stackId="claim" dataKey="locked" name="Locked" fill={chartTheme.bar2} />
        <Bar stackId="claim" dataKey="unclaimed" name="Unclaimed" fill={chartTheme.grid} />
      </BarChart>
    </ResponsiveContainer>
  );
}
