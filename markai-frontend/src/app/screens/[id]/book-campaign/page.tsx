"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { BookingSlotSelector } from "@/components/screens/booking/BookingSlotSelector";
import { CampaignForm } from "@/components/screens/booking/CampaignForm";
import { ScreenSelector } from "@/components/screens/booking/ScreenSelector";
import { getScreenById, type Screen } from "@/services/screenService";
import toast from "react-hot-toast";
import {
  calculateBaseHourlyRate,
  countUniqueDays,
  calculateDiscountedPrice,
  type FrequencyDiscount,
} from "@/lib/pricingUtils";
import { cn } from "@/lib/utils";

interface ScreenWithSlots {
  screen: Screen;
  selectedSlots: Set<string>;
  dateRange: {
    fromDate: Date | null;
    toDate: Date | null;
  };
  pricing: {
    baseHourlyRate: number;
    slotsCount: number;
    subtotal: number;
    frequencyDiscounts: FrequencyDiscount | null;
  };
}

const BookCampaignPage = () => {
  const params = useParams();
  const idParam = useMemo(() => {
    if (!params || typeof params.id === "undefined") return null;
    return Array.isArray(params.id) ? params.id[0] : params.id;
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  
  // Multi-screen state: Map<screenId, ScreenWithSlots>
  const [screensMap, setScreensMap] = useState<Map<string, ScreenWithSlots>>(new Map());
  const [currentScreenId, setCurrentScreenId] = useState<string | null>(null);
  
  // Selected dates for form display
  const [selectedDates, setSelectedDates] = useState<{ start: Date | null; end: Date | null }>({
    start: null,
    end: null,
  });

  // Fetch initial screen data from URL
  useEffect(() => {
    const fetchScreen = async () => {
      if (!idParam) return;

      try {
        setLoading(true);
        const screenData = await getScreenById(idParam);
        
        // Initialize with current screen
        const pricing = (screenData as any)?.pricing || {};
        const baseHourlyRate = calculateBaseHourlyRate(pricing);

        // Get frequency discounts from screen pricing (or use defaults)
        const frequencyDiscounts: FrequencyDiscount | null = pricing.frequency_discounts || null;

        setScreensMap(new Map([[screenData._id, {
          screen: screenData,
          selectedSlots: new Set<string>(),
          dateRange: {
            fromDate: null,
            toDate: null,
          },
          pricing: {
            baseHourlyRate,
            slotsCount: 0,
            subtotal: 0,
            frequencyDiscounts,
          }
        }]]));

        setCurrentScreenId(screenData._id);
      } catch (error) {
        console.error("Error fetching screen:", error);
        toast.error("Failed to load screen details");
      } finally {
        setLoading(false);
      }
    };

    fetchScreen();
  }, [idParam]);

  // Get currently active screen for display
  const currentScreen = currentScreenId ? screensMap.get(currentScreenId) : null;

  // Calculate aggregate values with offer/discount calculation
  const aggregateData = useMemo(() => {
    let totalSlots = 0;
    let totalBaseAmount = 0;
    let totalDiscountAmount = 0;
    const allParsedSlots: Array<{ start: string; end: string; screenId: string }> = [];

    // Collect all selected slots across screens to count unique days
    const allSelectedSlots = new Set<string>();
    screensMap.forEach((screenWithSlots) => {
      screenWithSlots.selectedSlots.forEach((slotId) => {
        allSelectedSlots.add(slotId);
      });
    });

    // Count unique days for offer calculation
    const uniqueDaysCount = countUniqueDays(allSelectedSlots);

    // Calculate per-screen pricing with discount
    screensMap.forEach((screenWithSlots, screenId) => {
      const slotsCount = screenWithSlots.selectedSlots.size;
      const screenUniqueDays = countUniqueDays(screenWithSlots.selectedSlots);

      // Calculate discounted price for this screen
      const discountedPricing = calculateDiscountedPrice(
        screenWithSlots.pricing.baseHourlyRate,
        slotsCount,
        screenWithSlots.pricing.frequencyDiscounts,
        screenUniqueDays
      );

      totalSlots += slotsCount;
      totalBaseAmount += discountedPricing.baseAmount;
      totalDiscountAmount += discountedPricing.discountAmount;

      // Parse slots for this screen
      screenWithSlots.selectedSlots.forEach((slotId) => {
        try {
          const lastHyphenIndex = slotId.lastIndexOf("-");
          if (lastHyphenIndex === -1) return;

          const dateISOPart = slotId.substring(0, lastHyphenIndex);
          const hourPart = parseInt(slotId.substring(lastHyphenIndex + 1), 10);

          if (isNaN(hourPart)) return;

          const baseDate = new Date(dateISOPart);
          if (isNaN(baseDate.getTime())) return;

          const startDateTime = new Date(baseDate);
          startDateTime.setHours(hourPart, 0, 0, 0);

          const endDateTime = new Date(baseDate);
          if (hourPart === 23) {
            endDateTime.setHours(23, 59, 0, 0);
          } else {
            endDateTime.setHours(hourPart + 1, 0, 0, 0);
          }

          allParsedSlots.push({
            start: startDateTime.toISOString(),
            end: endDateTime.toISOString(),
            screenId,
          });
        } catch {
          // Skip invalid slots
        }
      });
    });

    // Calculate overall date range
    let earliestStart: Date | null = null;
    let latestEnd: Date | null = null;

    if (allParsedSlots.length > 0) {
      const dates = allParsedSlots.map(slot => ({
        start: new Date(slot.start),
        end: new Date(slot.end)
      }));

      dates.sort((a, b) => a.start.getTime() - b.start.getTime());
      earliestStart = dates[0].start;
      latestEnd = dates.reduce(
        (latest, slot) => (slot.end.getTime() > latest.getTime() ? slot.end : latest),
        dates[0].end
      );
    }

    // Get the overall applicable offer and tier breakdown (for display)
    const firstScreen = screensMap.values().next().value;
    const discountedPricing = firstScreen && totalSlots > 0
      ? calculateDiscountedPrice(
          firstScreen.pricing.baseHourlyRate,
          totalSlots,
          firstScreen.pricing.frequencyDiscounts,
          uniqueDaysCount
        )
      : null;

    const totalFinalAmount = totalBaseAmount - totalDiscountAmount;

    return {
      totalSlots,
      totalAmount: totalFinalAmount, // This is the discounted amount
      totalBaseAmount,
      totalDiscountAmount,
      uniqueDaysCount,
      appliedOffer: discountedPricing?.appliedOffer || null,
      discountPercent: discountedPricing?.discountPercent || 0,
      tierBreakdown: discountedPricing?.tierBreakdown || [],
      isTieredPricing: discountedPricing?.isTieredPricing || false,
      allParsedSlots,
      earliestStart,
      latestEnd,
      screensCount: screensMap.size,
    };
  }, [screensMap]);

  // Update selected dates when slots change
  useEffect(() => {
    setSelectedDates({
      start: aggregateData.earliestStart,
      end: aggregateData.latestEnd,
    });
  }, [aggregateData]);

  const handleSlotToggle = (slotId: string) => {
    if (!currentScreenId) return;

    setScreensMap((prevMap) => {
      const newMap = new Map(prevMap);
      const screenData = newMap.get(currentScreenId);

      if (screenData) {
        const newSlots = new Set(screenData.selectedSlots);
        if (newSlots.has(slotId)) {
          newSlots.delete(slotId);
        } else {
          newSlots.add(slotId);
        }

        const slotsCount = newSlots.size;
        const subtotal = screenData.pricing.baseHourlyRate * slotsCount;

        newMap.set(currentScreenId, {
          ...screenData,
          selectedSlots: newSlots,
          pricing: {
            ...screenData.pricing,
            slotsCount,
            subtotal,
          }
        });
      }

      return newMap;
    });
  };

  const handleDateRangeChange = (fromDate: Date | null, toDate: Date | null) => {
    if (!currentScreenId) return;

    setScreensMap((prevMap) => {
      const newMap = new Map(prevMap);
      const screenData = newMap.get(currentScreenId);

      if (screenData) {
        newMap.set(currentScreenId, {
          ...screenData,
          dateRange: {
            fromDate,
            toDate,
          }
        });
      }

      return newMap;
    });
  };

  const handleToggleScreen = (screen: Screen) => {
    const screenId = screen._id;

    if (screensMap.has(screenId)) {
      // Remove screen
      setScreensMap((prevMap) => {
        const newMap = new Map(prevMap);
        newMap.delete(screenId);
        return newMap;
      });
      toast.success(`${(screen as any).screen_name || screen.venue_name} removed`);
    } else {
      // Add screen - use the screen data already passed (no extra API call needed)
      const pricing = (screen as any)?.pricing || {};
      const baseHourlyRate = calculateBaseHourlyRate(pricing);
      const frequencyDiscounts: FrequencyDiscount | null = pricing.frequency_discounts || null;

      setScreensMap((prevMap) => {
        const newMap = new Map(prevMap);
        newMap.set(screenId, {
          screen: screen,
          selectedSlots: new Set<string>(),
          dateRange: {
            fromDate: null,
            toDate: null,
          },
          pricing: {
            baseHourlyRate,
            slotsCount: 0,
            subtotal: 0,
            frequencyDiscounts,
          }
        });
        return newMap;
      });

      toast.success(`${(screen as any).screen_name || screen.venue_name} added`);
    }
  };

  const handleSelectAll = (screens: Screen[]) => {
    // Check if all filtered screens are already selected (excluding current screen which is always selected)
    const otherScreens = screens.filter(s => s._id !== currentScreenId);
    const allSelected = otherScreens.every(s => screensMap.has(s._id));

    if (allSelected && otherScreens.length > 0) {
      // Deselect all except current screen
      setScreensMap((prevMap) => {
        const newMap = new Map();
        // Keep only the current screen
        if (currentScreenId) {
          const currentData = prevMap.get(currentScreenId);
          if (currentData) {
            newMap.set(currentScreenId, currentData);
          }
        }
        return newMap;
      });
      toast.success(`Deselected ${otherScreens.length} screens`);
    } else {
      // Select all screens - use the screen data already available (no extra API calls)
      const newScreensToAdd = screens
        .filter(s => !screensMap.has(s._id))
        .map((screen) => {
          const pricing = (screen as any)?.pricing || {};
          const baseHourlyRate = calculateBaseHourlyRate(pricing);
          const frequencyDiscounts: FrequencyDiscount | null = pricing.frequency_discounts || null;
          return {
            screenId: screen._id,
            data: {
              screen: screen,
              selectedSlots: new Set<string>(),
              dateRange: {
                fromDate: null,
                toDate: null,
              },
              pricing: {
                baseHourlyRate,
                slotsCount: 0,
                subtotal: 0,
                frequencyDiscounts,
              }
            }
          };
        });

      setScreensMap((prevMap) => {
        const newMap = new Map(prevMap);
        newScreensToAdd.forEach(({ screenId, data }) => {
          newMap.set(screenId, data);
        });
        return newMap;
      });

      toast.success(`Selected ${newScreensToAdd.length} new screens`);
    }
  };

  const handleFormSubmit = (formData: any, file: File | null) => {
    setIsSubmitting(true);

    // Form submission is handled by the RazorpayPaymentButton
    setTimeout(() => {
      setIsSubmitting(false);
    }, 1500);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!currentScreen || !currentScreenId) {
    return (
      <div className="min-h-screen flex items-center justify-center transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <div className="text-center">
          <p className="text-xl mb-4 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Screen not found</p>
          <Link href="/browse-screens" className="text-purple-400 hover:text-purple-300 transition-colors duration-300">
            Back to Browse Screens
          </Link>
        </div>
      </div>
    );
  }

  // Get screen name
  const screenName = (currentScreen.screen as any).screen_name || currentScreen.screen.venue_name || "Screen";

  // Get Xibo display info from current screen
  const xiboDisplayId = (currentScreen.screen as any).xibo_display_id;
  const xiboDisplayGroupId = (currentScreen.screen as any).xibo_display_group_id;

  // Get selected screen IDs for the selector
  const selectedScreenIds = new Set(Array.from(screensMap.keys()));

  // Prepare screens data for form
  const screensData = Array.from(screensMap.entries()).map(([screenId, data]) => ({
    screenId,
    screenName: (data.screen as any).screen_name || data.screen.venue_name || "Screen",
    xiboDisplayId: (data.screen as any).xibo_display_id,
    xiboDisplayGroupId: (data.screen as any).xibo_display_group_id,
    selectedSlots: Array.from(data.selectedSlots),
    pricing: data.pricing,
  }));

  return (
    <div className="relative min-h-screen py-20 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(123,67,255,0.15),transparent_50%)]" />

      <div className="relative z-10 w-[95%] md:w-[90%] mx-auto pt-8 pb-12">
        {/* Header */}
        <div className="mb-8">
          <Link
            href={`/screens/${idParam}`}
            className="inline-flex items-center gap-2 transition-colors duration-300 mb-4 hover:opacity-80"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ArrowLeft className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
            Back to Screen Details
          </Link>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold heading-font transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                Book Campaign
              </h1>
              <p className="mt-2 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                {aggregateData.screensCount} screen{aggregateData.screensCount !== 1 ? 's' : ''} selected • {aggregateData.totalSlots} slot{aggregateData.totalSlots !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Add Screens Button */}
            <button
              onClick={() => setIsSelectorOpen(true)}
              className={cn(
                "px-4 md:px-6 py-2.5 md:py-3 rounded-lg font-semibold text-sm",
                "backdrop-blur-md border",
                "hover:opacity-80",
                "transition-all duration-300",
                "flex items-center gap-2"
              )}
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            >
              <Plus className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-primary)' }} />
              Add Screens
              {aggregateData.screensCount > 1 && (
                <span className="ml-1 px-2 py-0.5 rounded-full bg-purple-500 text-xs">
                  {aggregateData.screensCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Multi-Screen Tabs */}
        {aggregateData.screensCount > 1 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {Array.from(screensMap.entries()).map(([screenId, data]) => {
              const name = (data.screen as any).screen_name || data.screen.venue_name || "Screen";
              const isActive = screenId === currentScreenId;

              return (
                <button
                  key={screenId}
                  onClick={() => setCurrentScreenId(screenId)}
                  className={cn(
                    "px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap",
                    "border transition-all duration-300",
                    isActive
                      ? "bg-purple-600 border-purple-500 text-white"
                      : "hover:opacity-80"
                  )}
                  style={isActive ? {} : { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-tertiary)' }}
                >
                  {name}
                  {data.selectedSlots.size > 0 && (
                    <span className="ml-2 text-xs opacity-75">
                      ({data.selectedSlots.size})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="grid lg:grid-cols-10 gap-6">
          {/* Left Side - Calendar (70%) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Current Screen Info */}
            <div className="p-4 backdrop-blur-md border rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
              <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Selecting slots for:</p>
              <p className="text-lg font-semibold mt-1 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{screenName}</p>
            </div>

            {/* Applied Offer Display */}
            {aggregateData.totalSlots > 0 && aggregateData.appliedOffer && (
              <div className="p-4 backdrop-blur-md border rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: aggregateData.discountPercent > 0 ? '#22c55e' : 'var(--border-primary)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {aggregateData.isTieredPricing ? (
                      <span className="px-3 py-1 rounded-full text-sm font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                        Tiered Pricing
                      </span>
                    ) : (
                      <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                        aggregateData.discountPercent > 0
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                      }`}>
                        {aggregateData.appliedOffer.label}
                      </span>
                    )}
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {aggregateData.uniqueDaysCount} day{aggregateData.uniqueDaysCount !== 1 ? 's' : ''} selected
                    </span>
                  </div>
                  {aggregateData.discountPercent > 0 && (
                    <div className="text-right">
                      <span className="text-green-400 font-semibold">~{aggregateData.discountPercent}% OFF</span>
                      <p className="text-xs text-green-400/70">
                        Save ₹{aggregateData.totalDiscountAmount.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>

                {/* Tiered Pricing Breakdown */}
                {aggregateData.isTieredPricing && aggregateData.tierBreakdown.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-dashed space-y-2" style={{ borderColor: 'var(--border-primary)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                      Price Breakdown
                    </p>
                    {aggregateData.tierBreakdown.map((tier, index) => (
                      <div key={index} className="flex justify-between items-center text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            tier.discountPercent > 0
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}>
                            {tier.units} {tier.label}{tier.units > 1 ? 's' : ''}
                          </span>
                          {tier.discountPercent > 0 && (
                            <span className="text-xs text-green-400">
                              ({tier.discountPercent}% off)
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          {tier.discountPercent > 0 && (
                            <span className="text-xs line-through mr-2" style={{ color: 'var(--text-tertiary)' }}>
                              ₹{tier.baseAmount.toLocaleString()}
                            </span>
                          )}
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                            ₹{tier.finalAmount.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Summary for tiered or single pricing */}
                {aggregateData.discountPercent > 0 && (
                  <div className={`${aggregateData.isTieredPricing ? 'mt-2 pt-2' : 'mt-3 pt-3'} border-t border-dashed`} style={{ borderColor: 'var(--border-primary)' }}>
                    <div className="flex justify-between text-sm">
                      <span style={{ color: 'var(--text-tertiary)' }}>Original: ₹{aggregateData.totalBaseAmount.toLocaleString()}</span>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Final: ₹{aggregateData.totalAmount.toLocaleString()}</span>
                    </div>
                  </div>
                )}

                {/* Show next tier hint (only when not using tiered pricing) */}
                {!aggregateData.isTieredPricing && aggregateData.uniqueDaysCount > 0 && aggregateData.uniqueDaysCount < 30 && (
                  <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
                    {aggregateData.uniqueDaysCount < 7 && aggregateData.totalSlots < 16 && (
                      <>💡 Select a full day (16+ slots) for daily discount</>
                    )}
                    {aggregateData.uniqueDaysCount >= 1 && aggregateData.uniqueDaysCount < 7 && aggregateData.totalSlots >= 16 && (
                      <>💡 Select {7 - aggregateData.uniqueDaysCount} more day{7 - aggregateData.uniqueDaysCount !== 1 ? 's' : ''} for weekly discount</>
                    )}
                    {aggregateData.uniqueDaysCount >= 7 && aggregateData.uniqueDaysCount < 14 && (
                      <>💡 Select {14 - aggregateData.uniqueDaysCount} more day{14 - aggregateData.uniqueDaysCount !== 1 ? 's' : ''} for fortnightly discount</>
                    )}
                    {aggregateData.uniqueDaysCount >= 14 && aggregateData.uniqueDaysCount < 30 && (
                      <>💡 Select {30 - aggregateData.uniqueDaysCount} more day{30 - aggregateData.uniqueDaysCount !== 1 ? 's' : ''} for monthly discount</>
                    )}
                  </p>
                )}

                {/* Tiered pricing explanation */}
                {aggregateData.isTieredPricing && (
                  <p className="text-xs mt-2 italic" style={{ color: 'var(--text-tertiary)', opacity: 0.7 }}>
                    Your booking spans multiple duration tiers - each portion gets its own discount rate
                  </p>
                )}
              </div>
            )}

            <BookingSlotSelector
              key={currentScreenId}
              selectedSlots={currentScreen.selectedSlots}
              onSlotToggle={handleSlotToggle}
              fromDate={currentScreen.dateRange.fromDate}
              toDate={currentScreen.dateRange.toDate}
              onDateRangeChange={handleDateRangeChange}
            />
          </div>

          {/* Right Side - Form (30%) */}
          <div className="lg:col-span-3 space-y-6">
            <CampaignForm
              basePrice={currentScreen.pricing.baseHourlyRate}
              selectedSlotsCount={currentScreen.selectedSlots.size}
              onSubmit={handleFormSubmit}
              isSubmitting={isSubmitting}
              screenId={currentScreenId}
              screenName={screenName}
              startDate={selectedDates.start ? selectedDates.start.toISOString() : undefined}
              endDate={selectedDates.end ? selectedDates.end.toISOString() : undefined}
              xiboDisplayId={xiboDisplayId}
              xiboDisplayGroupId={xiboDisplayGroupId}
              selectedTimeSlots={aggregateData.allParsedSlots}
              screensData={screensData}
              totalAmount={aggregateData.totalAmount}
              totalSlots={aggregateData.totalSlots}
              isMultiScreen={aggregateData.screensCount > 1}
              discountPercent={aggregateData.discountPercent}
              discountAmount={aggregateData.totalDiscountAmount}
              appliedOfferLabel={aggregateData.appliedOffer?.label || ""}
              tierBreakdown={aggregateData.tierBreakdown}
              isTieredPricing={aggregateData.isTieredPricing}
            />
          </div>
        </div>
      </div>

      {/* Screen Selector Sidebar */}
      <ScreenSelector
        currentScreenId={currentScreenId}
        selectedScreenIds={selectedScreenIds}
        onToggleScreen={handleToggleScreen}
        onSelectAll={handleSelectAll}
        isOpen={isSelectorOpen}
        onClose={() => setIsSelectorOpen(false)}
      />
    </div>
  );
};

export default BookCampaignPage;
