"use client";

import { DollarSign, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PricingFrequency,
  FrequencyDiscount,
  FREQUENCY_MULTIPLIERS,
  FREQUENCY_LABELS,
  formatPrice,
} from "@/lib/pricingUtils";

interface FrequencyOption {
  value: PricingFrequency;
  label: string;
  price: number;
  basePrice: number;
  discountPercent: number;
  savingsAmount: number;
}

interface PricingFrequencySelectorProps {
  baseHourlyRate: number;
  currency: string;
  frequencyDiscounts: FrequencyDiscount;
  selectedFrequency: PricingFrequency;
  onSelect: (frequency: PricingFrequency) => void;
}

export const PricingFrequencySelector = ({
  baseHourlyRate,
  currency,
  frequencyDiscounts,
  selectedFrequency,
  onSelect,
}: PricingFrequencySelectorProps) => {
  // Calculate frequencies with pricing
  const frequencies = calculateFrequencies(
    baseHourlyRate,
    frequencyDiscounts
  );

  return (
    <div className="space-y-3">
      <p
        className="text-sm uppercase tracking-widest transition-colors duration-300"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Select Duration
      </p>
      <div className="space-y-3">
        {frequencies.map((freq) => (
          <button
            key={freq.value}
            onClick={() => onSelect(freq.value)}
            className="w-full rounded-2xl border px-4 py-3 flex items-center justify-between text-left transition-colors duration-300"
            style={{
              borderColor: selectedFrequency === freq.value ? 'var(--border-secondary)' : 'var(--border-primary)',
              backgroundColor: selectedFrequency === freq.value ? 'var(--bg-card)' : 'var(--bg-card)'
            }}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p
                  className="font-medium transition-colors duration-300"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {freq.label}
                </p>
                {freq.discountPercent > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                    Save {freq.discountPercent}%
                  </span>
                )}
              </div>
              <p
                className="text-sm mt-1 transition-colors duration-300"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {formatPrice(freq.price, currency)}
              </p>
              {freq.savingsAmount > 0 && (
                <p className="text-xs text-green-400 mt-0.5 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" />
                  Save {formatPrice(freq.savingsAmount, currency)}
                </p>
              )}
            </div>
            <DollarSign
              className="w-4 h-4 transition-colors duration-300"
              style={{ color: 'var(--text-secondary)' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

// Helper function to calculate all frequencies
function calculateFrequencies(
  baseHourlyRate: number,
  discounts: FrequencyDiscount
): FrequencyOption[] {
  return Object.entries(FREQUENCY_MULTIPLIERS).map(([key, multiplier]) => {
    const freq = key as PricingFrequency;
    const discount = discounts[freq] || 0;
    const basePrice = baseHourlyRate * multiplier;
    const price = basePrice * (1 - discount / 100);
    const savingsAmount = discount > 0 ? basePrice - price : 0;

    return {
      value: freq,
      label: FREQUENCY_LABELS[freq],
      price: Math.round(price),
      basePrice: Math.round(basePrice),
      discountPercent: discount,
      savingsAmount: Math.round(savingsAmount),
    };
  });
}
