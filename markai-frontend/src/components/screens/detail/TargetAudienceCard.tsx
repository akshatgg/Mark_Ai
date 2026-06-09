"use client";

import { Target, TrendingUp, CalendarDays } from "lucide-react";

interface TargetAudienceData {
  primary: string;
  affluence: string;
  occasions: string;
}

type TargetAudienceCardProps = {
  data: TargetAudienceData;
};

export const TargetAudienceCard = ({ data }: TargetAudienceCardProps) => {
  const items = [
    {
      icon: Target,
      label: "Primary",
      text: data.primary
    },
    {
      icon: TrendingUp,
      label: "Affluence",
      text: data.affluence
    },
    {
      icon: CalendarDays,
      label: "Occasions",
      text: data.occasions
    },
  ];

  return (
    <div
      className="rounded-3xl border p-6 space-y-4 transition-colors duration-300"
      style={{
        borderColor: 'var(--border-primary)',
        backgroundColor: 'var(--bg-card)'
      }}
    >
      <h3
        className="text-2xl font-semibold heading-font transition-colors duration-300"
        style={{ color: 'var(--text-primary)' }}
      >
        Target audience
      </h3>
      <div className="space-y-3 text-sm">
        {items.map(({ icon: Icon, label, text }) => (
          <div key={label} className="space-y-1">
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-[var(--brand-blue)]" />
              <span
                className="font-medium transition-colors duration-300"
                style={{ color: 'var(--text-secondary)' }}
              >
                {label}:
              </span>
            </div>
            <p
              className="pl-6 leading-relaxed transition-colors duration-300"
              style={{ color: 'var(--text-primary)' }}
            >
              {text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
