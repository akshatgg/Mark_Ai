"use client";

import { Sparkles } from "lucide-react";

type ScreenInsightsProps = {
  description: string;
  highlights: string[];
};

export const ScreenInsights = ({ description, highlights }: ScreenInsightsProps) => {
  return (
    <div
      className="rounded-3xl border p-6 space-y-4 transition-colors duration-300"
      style={{
        borderColor: 'var(--border-primary)',
        backgroundColor: 'var(--bg-card)'
      }}
    >
      <h3
        className="text-2xl md:text-3xl font-semibold heading-font transition-colors duration-300"
        style={{ color: 'var(--text-primary)' }}
      >
        Campaign Insights
      </h3>
      <p
        className="leading-relaxed transition-colors duration-300"
        style={{ color: 'var(--text-secondary)' }}
      >
        {description}
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        {highlights.map((highlight) => (
          <div
            key={highlight}
            className="flex items-start gap-3 rounded-2xl border p-4 transition-colors duration-300"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--bg-primary)'
            }}
          >
            <Sparkles className="w-5 h-5 text-[var(--brand-blue)] mt-1" />
            <p
              className="text-sm transition-colors duration-300"
              style={{ color: 'var(--text-secondary)' }}
            >
              {highlight}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

