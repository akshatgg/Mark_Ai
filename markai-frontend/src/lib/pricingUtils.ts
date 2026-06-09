export type PricingFrequency = "hourly" | "daily" | "weekly" | "fortnightly" | "monthly";

export const FREQUENCY_MULTIPLIERS: Record<PricingFrequency, number> = {
  hourly: 1,
  daily: 24,
  weekly: 168,  // 24 * 7
  fortnightly: 336,  // 24 * 14
  monthly: 720  // 24 * 30
};

export const FREQUENCY_LABELS: Record<PricingFrequency, string> = {
  hourly: "Per Hour",
  daily: "Per Day",
  weekly: "Per Week",
  fortnightly: "Per Fortnight",
  monthly: "Per Month",
};

export const FREQUENCY_UNIT_LABELS: Record<PricingFrequency, string> = {
  hourly: "hour",
  daily: "day",
  weekly: "week",
  fortnightly: "fortnight",
  monthly: "month",
};

export interface CalculatedRate {
  price: number;
  multiplier: number;
  discount_percent: number;
}

export type CalculatedRates = Record<PricingFrequency, CalculatedRate>;

export interface FrequencyDiscount {
  hourly: number;
  daily: number;
  weekly: number;
  fortnightly: number;
  monthly: number;
}

export function calculateFrequencyRates(
  baseHourlyRate: number,
  discounts: FrequencyDiscount
): CalculatedRates {
  const rates: any = {};

  Object.entries(FREQUENCY_MULTIPLIERS).forEach(([freq, multiplier]) => {
    const frequency = freq as PricingFrequency;
    const discount = discounts[frequency] || 0;
    const basePrice = baseHourlyRate * multiplier;
    const finalPrice = basePrice * (1 - discount / 100);

    rates[frequency] = {
      price: Math.round(finalPrice),
      multiplier,
      discount_percent: discount,
    };
  });

  return rates;
}

export function formatPrice(amount: number, currency: string = "INR"): string {
  const symbol = currency === "INR" ? "₹" : "$";
  return `${symbol}${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function getDefaultDiscounts(): FrequencyDiscount {
  return {
    hourly: 0,
    daily: 10,
    weekly: 15,
    fortnightly: 20,
    monthly: 25,
  };
}

/**
 * Calculates base hourly rate from pricing data
 * Handles both new format (base_hourly_rate) and legacy format (price + unit)
 * Ensures consistent pricing calculation across all pages
 *
 * @param pricing - Pricing object from screen data
 * @returns Base hourly rate, defaults to 30 if not available
 */
export function calculateBaseHourlyRate(pricing: any): number {
  // Priority 1: Use base_hourly_rate if available
  if (pricing?.base_hourly_rate) {
    return pricing.base_hourly_rate;
  }

  // Priority 2: Calculate from legacy price
  if (pricing?.price) {
    const unit = (pricing.unit || "per week").toLowerCase();
    const price = pricing.price;

    if (unit.includes("hour") || unit.includes("hr")) {
      return price;
    } else if (unit.includes("day")) {
      return Math.round(price / 24);
    } else if (unit.includes("week")) {
      return Math.round(price / 168);
    } else if (unit.includes("month")) {
      return Math.round(price / 720);
    } else {
      // Default: assume weekly
      return Math.round(price / 168);
    }
  }

  // Priority 3: Default fallback
  return 30;
}

/**
 * Determines the best applicable offer based on the number of unique days selected
 *
 * IMPORTANT: Only ONE offer can apply at a time - it automatically picks the BEST one
 * You CANNOT combine weekly + monthly or any other offers together.
 *
 * Example: If user selects 60 days (2 months), the monthly offer applies ONCE
 * as a percentage discount on the total price, NOT monthly rate × 2.
 *
 * Offer Tiers (in priority order):
 * - 30+ days = Monthly offer (highest discount)
 * - 14-29 days = Fortnightly offer
 * - 7-13 days = Weekly offer
 * - 1-6 days (with 16+ slots) = Daily offer
 * - Less than a full day = Hourly rate (no discount)
 *
 * @param uniqueDaysCount - Number of unique dates with selected slots
 * @param totalSlotsCount - Total number of hourly slots selected
 * @returns The applicable frequency for offer
 */
export function getApplicableOffer(
  uniqueDaysCount: number,
  totalSlotsCount: number
): { frequency: PricingFrequency; label: string; minDays: number } {
  // Monthly: 30+ days (applies for 1 month, 2 months, 3 months, etc.)
  // The monthly discount percentage is applied to the total price
  if (uniqueDaysCount >= 30) {
    return { frequency: "monthly", label: "Monthly Offer", minDays: 30 };
  }

  // Fortnightly: 14-29 days
  if (uniqueDaysCount >= 14) {
    return { frequency: "fortnightly", label: "Fortnightly Offer", minDays: 14 };
  }

  // Weekly: 7-13 days
  if (uniqueDaysCount >= 7) {
    return { frequency: "weekly", label: "Weekly Offer", minDays: 7 };
  }

  // Daily: 1-6 days (at least 1 full day of slots - 16 slots = 8am-midnight)
  if (uniqueDaysCount >= 1 && totalSlotsCount >= 16) {
    return { frequency: "daily", label: "Daily Offer", minDays: 1 };
  }

  // Hourly: Less than a day worth
  return { frequency: "hourly", label: "Hourly Rate", minDays: 0 };
}

/**
 * Tier breakdown item for displaying price split
 */
export interface TierBreakdownItem {
  frequency: PricingFrequency;
  label: string;
  units: number;  // e.g., 2 months, 1 week
  days: number;   // total days for this tier
  slots: number;  // total slots for this tier
  baseAmount: number;
  discountPercent: number;
  discountAmount: number;
  finalAmount: number;
}

/**
 * Calculates the discounted price using TIERED SPLIT approach
 *
 * This splits the booking duration into the largest possible units and applies
 * the appropriate discount to each portion.
 *
 * Example: 67 days = 2 months (60 days) + 1 week (7 days)
 *   - 60 days × hourly_rate × 24 × (1 - monthly_discount%)
 *   - 7 days × hourly_rate × 24 × (1 - weekly_discount%)
 *
 * This is FAIR to both business and customer - no excessive discounts given.
 *
 * @param baseHourlyRate - Base price per hour
 * @param totalSlots - Total number of slots selected
 * @param discounts - Frequency discounts from screen pricing
 * @param uniqueDaysCount - Number of unique days selected
 * @returns Pricing breakdown with tiered discount applied
 */
export function calculateDiscountedPrice(
  baseHourlyRate: number,
  totalSlots: number,
  discounts: FrequencyDiscount | null,
  uniqueDaysCount: number
): {
  baseAmount: number;
  discountPercent: number;  // Average/effective discount percentage
  discountAmount: number;
  finalAmount: number;
  appliedOffer: { frequency: PricingFrequency; label: string; minDays: number };
  tierBreakdown: TierBreakdownItem[];
  isTieredPricing: boolean;
} {
  const baseAmount = baseHourlyRate * totalSlots;

  // Calculate tiered breakdown
  const tierBreakdown = calculateTierBreakdown(
    uniqueDaysCount,
    totalSlots,
    baseHourlyRate,
    discounts
  );

  // Sum up all tier amounts
  let totalDiscountAmount = 0;
  let totalFinalAmount = 0;

  tierBreakdown.forEach(tier => {
    totalDiscountAmount += tier.discountAmount;
    totalFinalAmount += tier.finalAmount;
  });

  // Calculate effective discount percentage
  const effectiveDiscountPercent = baseAmount > 0
    ? Math.round((totalDiscountAmount / baseAmount) * 100)
    : 0;

  // Get the highest tier applied (for display purposes)
  const highestTier = tierBreakdown.length > 0
    ? tierBreakdown[0]
    : null;

  const appliedOffer = highestTier
    ? {
        frequency: highestTier.frequency,
        label: highestTier.label,
        minDays: getMinDaysForFrequency(highestTier.frequency)
      }
    : { frequency: "hourly" as PricingFrequency, label: "Hourly Rate", minDays: 0 };

  // Check if multiple tiers are being used
  const isTieredPricing = tierBreakdown.length > 1;

  return {
    baseAmount,
    discountPercent: effectiveDiscountPercent,
    discountAmount: totalDiscountAmount,
    finalAmount: totalFinalAmount,
    appliedOffer,
    tierBreakdown,
    isTieredPricing,
  };
}

/**
 * Get minimum days required for a frequency tier
 */
function getMinDaysForFrequency(frequency: PricingFrequency): number {
  switch (frequency) {
    case "monthly": return 30;
    case "fortnightly": return 14;
    case "weekly": return 7;
    case "daily": return 1;
    default: return 0;
  }
}

/**
 * Calculate the tier breakdown for pricing
 * Splits duration into largest possible units: months → fortnights → weeks → days → hours
 */
function calculateTierBreakdown(
  uniqueDaysCount: number,
  totalSlots: number,
  baseHourlyRate: number,
  discounts: FrequencyDiscount | null
): TierBreakdownItem[] {
  const breakdown: TierBreakdownItem[] = [];
  let remainingDays = uniqueDaysCount;
  let remainingSlots = totalSlots;

  // Tier definitions: days per unit
  const tiers: Array<{
    frequency: PricingFrequency;
    label: string;
    daysPerUnit: number;
    minDays: number;
  }> = [
    { frequency: "monthly", label: "Monthly", daysPerUnit: 30, minDays: 30 },
    { frequency: "fortnightly", label: "Fortnightly", daysPerUnit: 14, minDays: 14 },
    { frequency: "weekly", label: "Weekly", daysPerUnit: 7, minDays: 7 },
    { frequency: "daily", label: "Daily", daysPerUnit: 1, minDays: 1 },
  ];

  // Process each tier from largest to smallest
  for (const tier of tiers) {
    if (remainingDays >= tier.minDays) {
      const units = Math.floor(remainingDays / tier.daysPerUnit);

      if (units > 0) {
        const daysForTier = units * tier.daysPerUnit;
        // Calculate slots proportionally based on days
        const slotsForTier = Math.min(
          Math.round((daysForTier / uniqueDaysCount) * totalSlots),
          remainingSlots
        );

        if (slotsForTier > 0) {
          const tierBaseAmount = baseHourlyRate * slotsForTier;
          const tierDiscountPercent = discounts?.[tier.frequency] ?? 0;
          const tierDiscountAmount = Math.round(tierBaseAmount * (tierDiscountPercent / 100));
          const tierFinalAmount = tierBaseAmount - tierDiscountAmount;

          breakdown.push({
            frequency: tier.frequency,
            label: tier.label,
            units,
            days: daysForTier,
            slots: slotsForTier,
            baseAmount: tierBaseAmount,
            discountPercent: tierDiscountPercent,
            discountAmount: tierDiscountAmount,
            finalAmount: tierFinalAmount,
          });

          remainingDays -= daysForTier;
          remainingSlots -= slotsForTier;
        }
      }
    }
  }

  // Handle remaining slots as hourly (no discount)
  if (remainingSlots > 0) {
    const tierBaseAmount = baseHourlyRate * remainingSlots;
    const tierDiscountPercent = discounts?.hourly ?? 0;
    const tierDiscountAmount = Math.round(tierBaseAmount * (tierDiscountPercent / 100));
    const tierFinalAmount = tierBaseAmount - tierDiscountAmount;

    breakdown.push({
      frequency: "hourly",
      label: "Hourly",
      units: remainingSlots,
      days: 0,
      slots: remainingSlots,
      baseAmount: tierBaseAmount,
      discountPercent: tierDiscountPercent,
      discountAmount: tierDiscountAmount,
      finalAmount: tierFinalAmount,
    });
  }

  return breakdown;
}

/**
 * Counts unique days from a set of slot IDs
 * Slot ID format: "2026-01-23T00:00:00.000Z-10"
 *
 * @param selectedSlots - Set of slot IDs
 * @returns Number of unique days
 */
export function countUniqueDays(selectedSlots: Set<string>): number {
  const uniqueDates = new Set<string>();

  selectedSlots.forEach((slotId) => {
    // Extract date part from slot ID
    const match = slotId.match(/^(.+T\d{2}:\d{2}:\d{2}\.\d{3}Z)-\d+$/);
    if (match) {
      const date = new Date(match[1]);
      // Use date string (YYYY-MM-DD) as unique key
      uniqueDates.add(date.toISOString().split('T')[0]);
    }
  });

  return uniqueDates.size;
}
