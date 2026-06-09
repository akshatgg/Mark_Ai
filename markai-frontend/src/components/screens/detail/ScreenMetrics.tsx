"use client";

import { ScreenMetrics as ScreenMetricsType } from "@/data/screens";

type ScreenMetricsGridProps = {
  metrics: ScreenMetricsType;
  location: string;
};

export const ScreenMetricsGrid = ({ metrics, location }: ScreenMetricsGridProps) => {
  const metricItems = [
    { label: "Footfall", value: metrics.footfall },
    { label: "Location", value: location },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {metricItems.map((metric) => (
        <div
          key={metric.label}
          className="rounded-2xl border p-4 transition-colors duration-300"
          style={{
            borderColor: 'var(--border-primary)',
            backgroundColor: 'var(--bg-card)'
          }}
        >
          <p
            className="text-sm mb-1 transition-colors duration-300"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {metric.label}
          </p>
          <p
            className="text-xl font-semibold transition-colors duration-300"
            style={{ color: 'var(--text-primary)' }}
          >
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  );
};

