"use client";
import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, Percent } from "lucide-react";
import { FrequencyDiscount } from "@/services/screenService";
import {
  calculateFrequencyRates,
  formatPrice,
  FREQUENCY_UNIT_LABELS
} from "@/lib/pricingUtils";

interface FrequencyDiscountEditorProps {
  baseHourlyRate: number;
  currency: string;
  discounts: FrequencyDiscount;
  onDiscountsChange: (discounts: FrequencyDiscount) => void;
  disabled?: boolean;
}

const FrequencyDiscountEditor: React.FC<FrequencyDiscountEditorProps> = ({
  baseHourlyRate,
  currency,
  discounts,
  onDiscountsChange,
  disabled = false,
}) => {
  const handleDiscountChange = (frequency: keyof FrequencyDiscount, value: string) => {
    const numValue = parseFloat(value) || 0;
    // Clamp between 0 and 100
    const clampedValue = Math.max(0, Math.min(100, numValue));

    onDiscountsChange({
      ...discounts,
      [frequency]: clampedValue,
    });
  };

  // Calculate rates with current discounts
  const calculatedRates = calculateFrequencyRates(baseHourlyRate, discounts);

  const frequencies: Array<{
    key: keyof FrequencyDiscount;
    label: string;
    description: string;
  }> = [
    {
      key: "hourly",
      label: "Per Hour",
      description: "Short-term campaigns (1 hour)",
    },
    {
      key: "daily",
      label: "Per Day",
      description: "Daily campaigns (24 hours)",
    },
    {
      key: "weekly",
      label: "Per Week",
      description: "Weekly campaigns (7 days)",
    },
    {
      key: "fortnightly",
      label: "Per Fortnight",
      description: "Bi-weekly campaigns (14 days)",
    },
    {
      key: "monthly",
      label: "Per Month",
      description: "Monthly campaigns (30 days)",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-400">
          Set discount percentages for each duration to incentivize longer bookings.
          The final price will be calculated as: Base Hourly Rate × Duration Multiplier × (1 - Discount%)
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {frequencies.map((freq) => {
          const rate = calculatedRates[freq.key];
          const originalPrice = baseHourlyRate * rate.multiplier;
          const hasDiscount = discounts[freq.key] > 0;

          return (
            <Card key={freq.key} className="border transition-all duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Label className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{freq.label}</Label>
                      {hasDiscount && (
                        <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                          Save {discounts[freq.key]}%
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>{freq.description}</p>

                    <div className="flex items-baseline gap-2 mt-2">
                      {hasDiscount && (
                        <span className="text-sm line-through transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                          {formatPrice(originalPrice, currency)}
                        </span>
                      )}
                      <span className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                        {formatPrice(rate.price, currency)}
                      </span>
                      <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                        / {FREQUENCY_UNIT_LABELS[freq.key]}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-32">
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={discounts[freq.key] || 0}
                        onChange={(e) => handleDiscountChange(freq.key, e.target.value)}
                        disabled={disabled}
                        className="border pr-8 text-right transition-all duration-300"
                        style={{
                          backgroundColor: 'var(--bg-accent)',
                          borderColor: 'var(--border-primary)',
                          color: 'var(--text-primary)'
                        }}
                        placeholder="0"
                      />
                      <Percent className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="p-3 rounded-lg transition-all duration-300" style={{ backgroundColor: 'var(--bg-accent)', borderColor: 'var(--border-primary)', borderWidth: '1px', borderStyle: 'solid' }}>
        <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
          <strong className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Note:</strong> Changes to discounts will be reflected on the screen detail page for advertisers.
          Base hourly rate: <strong className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{formatPrice(baseHourlyRate, currency)}/hour</strong>
        </p>
      </div>
    </div>
  );
};

export default FrequencyDiscountEditor;
