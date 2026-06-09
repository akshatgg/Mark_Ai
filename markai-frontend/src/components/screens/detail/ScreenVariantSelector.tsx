"use client";

import { ScreenVariant } from "@/data/screens";
import { cn } from "@/lib/utils";

type ScreenVariantSelectorProps = {
  variants: ScreenVariant[];
  selectedVariant: string;
  onSelect: (value: string) => void;
};

export const ScreenVariantSelector = ({
  variants,
  selectedVariant,
  onSelect,
}: ScreenVariantSelectorProps) => {
  return (
    <div className="space-y-3">
      <p
        className="text-sm uppercase tracking-widest transition-colors duration-300"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Screen variant
      </p>
      <div className="space-y-3">
        {variants.map((variant) => (
          <button
            key={variant.value}
            onClick={() => onSelect(variant.value)}
            className="w-full rounded-2xl border px-4 py-4 text-left transition-colors duration-300"
            style={{
              borderColor: selectedVariant === variant.value ? 'var(--border-secondary)' : 'var(--border-primary)',
              backgroundColor: selectedVariant === variant.value ? 'var(--bg-card)' : 'var(--bg-card)'
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p
                  className="font-semibold transition-colors duration-300"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {variant.label}
                </p>
                <p
                  className="text-sm transition-colors duration-300"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {variant.spec}
                </p>
              </div>
              <p
                className="text-lg font-semibold transition-colors duration-300"
                style={{ color: 'var(--text-primary)' }}
              >
                ₹{variant.price.toLocaleString()}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

