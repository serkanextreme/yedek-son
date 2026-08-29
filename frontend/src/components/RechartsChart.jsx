import React from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

/**
 * Renders a chart from an aggregated [{x, y}] dataset returned by
 * POST /api/excel/{id}/chart-data. Chart `type` matches the LLM's
 * chart suggestion (bar/column/line/area/pie/scatter).
 */
const CHART_COLORS = [
  "#22d3ee", // cyan-400
  "#38bdf8", // sky-400
  "#60a5fa", // blue-400
  "#a78bfa", // violet-400
  "#f472b6", // pink-400
  "#f59e0b", // amber-500
  "#34d399", // emerald-400
  "#fbbf24", // amber-400
  "#f87171", // red-400
  "#c084fc", // purple-400
];

const axisProps = {
  stroke: "#67e8f9",
  tick: { fill: "#a3d9e5", fontSize: 10, fontFamily: "monospace" },
};
const gridProps = {
  strokeDasharray: "3 3",
  stroke: "#22d3ee22",
};
const tooltipStyle = {
  contentStyle: {
    background: "#0b1220",
    border: "1px solid #22d3ee55",
    fontFamily: "monospace",
    fontSize: 11,
  },
  cursor: { fill: "#22d3ee11" },
};

const RechartsChart = ({ type = "bar", data = [], xLabel = "x", yLabel = "y" }) => {
  if (!data || data.length === 0) {
    return (
      <div className="text-xs font-mono text-sertex-textMuted italic">
        Bu grafik için veri yok.
      </div>
    );
  }

  const t = (type || "bar").toLowerCase();

  if (t === "pie") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="y"
            nameKey="x"
            cx="50%"
            cy="50%"
            outerRadius={90}
            label={{ fontSize: 10, fill: "#a3d9e5" }}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (t === "line") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 20 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="x" {...axisProps} label={{ value: xLabel, position: "insideBottom", offset: -8, fill: "#67e8f9", fontSize: 10 }} />
          <YAxis {...axisProps} />
          <Tooltip {...tooltipStyle} />
          <Line type="monotone" dataKey="y" name={yLabel} stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (t === "area") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 20 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="x" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip {...tooltipStyle} />
          <Area type="monotone" dataKey="y" name={yLabel} stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.3} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (t === "scatter") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 10, right: 12, left: 0, bottom: 20 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="x" {...axisProps} />
          <YAxis dataKey="y" {...axisProps} />
          <Tooltip {...tooltipStyle} />
          <Scatter data={data} fill={CHART_COLORS[0]} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  // Default: bar / column
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 20 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="x" {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey="y" name={yLabel} radius={[3, 3, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

export default RechartsChart;
