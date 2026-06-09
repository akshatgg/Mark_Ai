"use client";

import { Calendar } from "lucide-react";
import { ScreenFrequency } from "@/data/screens";
import { cn } from "@/lib/utils";

type ScreenFrequencySelectorProps = {
  frequencies: ScreenFrequency[];
  selectedFrequency: string;
  onSelect: (value: string) => void;
};

export const ScreenFrequencySelector = ({
  frequencies,
  selectedFrequency,
  onSelect,
}: ScreenFrequencySelectorProps) => {
  return (
    <div className="space-y-3">
      <p
        className="text-sm uppercase tracking-widest transition-colors duration-300"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Frequency
      </p>
      <div className="space-y-3">
        {frequencies.map((frequency) => (
          <button
            key={frequency.value}
            onClick={() => onSelect(frequency.value)}
            className="w-full rounded-2xl border px-4 py-3 flex items-center justify-between text-left transition-colors duration-300"
            style={{
              borderColor: selectedFrequency === frequency.value ? 'var(--border-secondary)' : 'var(--border-primary)',
              backgroundColor: selectedFrequency === frequency.value ? 'var(--bg-card)' : 'var(--bg-card)'
            }}
          >
            <div>
              <p
                className="font-medium transition-colors duration-300"
                style={{ color: 'var(--text-primary)' }}
              >
                {frequency.label}
              </p>
              <p
                className="text-xs transition-colors duration-300"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {frequency.savings}
              </p>
            </div>
            <Calendar
              className="w-4 h-4 transition-colors duration-300"
              style={{ color: 'var(--text-secondary)' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

