"use client";
import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { getScreenById as getScreenByIdAPI, updateScreen as updateScreenAPI } from "@/services/screenService";
import { ScreenGallery } from "@/components/screens/detail/ScreenGallery";
import { ScreenMetricsGrid } from "@/components/screens/detail/ScreenMetrics";
import { EditableScreenMetrics } from "@/components/screens/detail/EditableScreenMetrics";
import { ScreenInsights } from "@/components/screens/detail/ScreenInsights";
import { EditableScreenInsights } from "@/components/screens/detail/EditableScreenInsights";
import { ScreenOverviewCard } from "@/components/screens/detail/ScreenOverviewCard";
import { EditableScreenOverview } from "@/components/screens/detail/EditableScreenOverview";
import { ScreenCategoryBadges } from "@/components/screens/detail/ScreenCategoryBadges";
import { EditableScreenCategoryBadges } from "@/components/screens/detail/EditableScreenCategoryBadges";
import { ScreenVenueSnapshotCard } from "@/components/screens/detail/ScreenVenueSnapshotCard";
import { EditableScreenVenueSnapshot } from "@/components/screens/detail/EditableScreenVenueSnapshot";
import { TargetAudienceCard } from "@/components/screens/detail/TargetAudienceCard";
import { EditableTargetAudienceCard } from "@/components/screens/detail/EditableTargetAudienceCard";
import { StartCampaignDialog } from "@/components/screens/detail/StartCampaignDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  PricingFrequency,
  calculateFrequencyRates,
  getDefaultDiscounts,
  formatPrice,
  calculateBaseHourlyRate,
  FREQUENCY_UNIT_LABELS,
} from "@/lib/pricingUtils";

// Default values for fields not provided by API
const DEFAULT_VARIANTS = [
  { value: "full-day", label: "Full Day", spec: "24 hours display" },
  { value: "half-day", label: "Half Day", spec: "12 hours display" },
];

const DEFAULT_FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const DEFAULT_CATEGORIES = ["Digital", "Indoor", "Premium"];

const ScreensDetailedPage = () => {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const idParam = useMemo(() => {
    if (!params || typeof params.id === "undefined") return null;
    return Array.isArray(params.id) ? params.id[0] : params.id;
  }, [params]);

  const [screen, setScreen] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeImage, setActiveImage] = useState("");
  const [selectedVariant, setSelectedVariant] = useState(DEFAULT_VARIANTS[0].value);
  const [selectedFrequency, setSelectedFrequency] = useState<PricingFrequency>("hourly");
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  useEffect(() => {
    const fetchScreen = async () => {
      if (!idParam) return;
      try {
        setLoading(true);
        const response = await getScreenByIdAPI(idParam);
        const screenData = (response as any).screen || response;
        setScreen(screenData);
        
        // Set active image from API
        const images = screenData.screen_images || screenData.media_gallery?.filter((m: any) => m.type === "image").map((m: any) => m.url) || [];
        if (images.length > 0) {
          setActiveImage(images[0]);
        }
      } catch (error) {
        console.error("Error fetching screen:", error);
        toast.error("Failed to load screen details");
      } finally {
        setLoading(false);
      }
    };
    fetchScreen();
  }, [idParam]);

  const activeVariant = DEFAULT_VARIANTS.find((variant) => variant.value === selectedVariant);

  // Check if user is admin
  const isAdmin = user?.section === "admin";

  // Handler to update metrics
  const handleUpdateMetrics = async (updatedMetrics: { footfall: string }) => {
    if (!idParam) return;

    try {
      await updateScreenAPI(idParam, {
        campaign_insights: {
          ...screen.campaign_insights,
          weekly_footfall_display: updatedMetrics.footfall,
        }
      });

      // Update local state using functional form to avoid stale state
      setScreen((prevScreen: any) => ({
        ...prevScreen,
        campaign_insights: {
          ...prevScreen.campaign_insights,
          weekly_footfall_display: updatedMetrics.footfall,
        }
      }));

      toast.success("Metrics updated successfully");
    } catch (error) {
      console.error("Error updating metrics:", error);
      toast.error("Failed to update metrics");
      throw error;
    }
  };

  // Handler to update campaign insights highlights
  const handleUpdateInsights = async (updatedHighlights: string[]) => {
    if (!idParam) return;

    try {
      await updateScreenAPI(idParam, {
        campaign_insights: {
          ...screen.campaign_insights,
          benefits: updatedHighlights
        }
      });

      // Update local state using functional form to avoid stale state
      setScreen((prevScreen: any) => ({
        ...prevScreen,
        campaign_insights: {
          ...prevScreen.campaign_insights,
          benefits: updatedHighlights
        }
      }));

      toast.success("Campaign insights updated successfully");
    } catch (error) {
      console.error("Error updating insights:", error);
      toast.error("Failed to update campaign insights");
      throw error;
    }
  };

  // Handler to update venue snapshot
  const handleUpdateVenueSnapshot = async (updatedVenue: {
    operating_hours: string;
    avg_daily_visitors: string;
    screen_position: string;
    environment: string;
  }) => {
    if (!idParam) return;

    try {
      await updateScreenAPI(idParam, {
        operational_info: {
          ...screen.operational_info,
          operating_hours: updatedVenue.operating_hours,
          avg_daily_visitors: updatedVenue.avg_daily_visitors,
          screen_position: updatedVenue.screen_position,
          environment: updatedVenue.environment,
        }
      });

      // Update local state using functional form to avoid stale state
      setScreen((prevScreen: any) => ({
        ...prevScreen,
        operational_info: {
          ...prevScreen.operational_info,
          operating_hours: updatedVenue.operating_hours,
          avg_daily_visitors: updatedVenue.avg_daily_visitors,
          screen_position: updatedVenue.screen_position,
          environment: updatedVenue.environment,
        }
      }));

      toast.success("Venue snapshot updated successfully");
    } catch (error) {
      console.error("Error updating venue snapshot:", error);
      toast.error("Failed to update venue snapshot");
      throw error;
    }
  };

  // Handler to update rating and reviews
  const handleUpdateRatingReviews = async (updatedData: {
    rating: number;
    verified_reviews: number;
  }) => {
    if (!idParam) return;

    try {
      await updateScreenAPI(idParam, {
        operational_info: {
          ...screen.operational_info,
          rating: updatedData.rating,
          verified_reviews: updatedData.verified_reviews,
        }
      });

      // Update local state using functional form to avoid stale state
      setScreen((prevScreen: any) => ({
        ...prevScreen,
        operational_info: {
          ...prevScreen.operational_info,
          rating: updatedData.rating,
          verified_reviews: updatedData.verified_reviews,
        }
      }));
    } catch (error) {
      console.error("Error updating rating and reviews:", error);
      throw error;
    }
  };

  // Handler to update location
  const handleUpdateLocation = async (updatedLocation: {
    street: string;
    city: string;
    state: string;
    country: string;
  }) => {
    if (!idParam) return;

    try {
      await updateScreenAPI(idParam, {
        location: {
          ...screen.location,
          street: updatedLocation.street,
          city: updatedLocation.city,
          state: updatedLocation.state,
          country: updatedLocation.country,
        }
      });

      // Update local state using functional form to avoid stale state
      setScreen((prevScreen: any) => ({
        ...prevScreen,
        location: {
          ...prevScreen.location,
          street: updatedLocation.street,
          city: updatedLocation.city,
          state: updatedLocation.state,
          country: updatedLocation.country,
        }
      }));
    } catch (error) {
      console.error("Error updating location:", error);
      throw error;
    }
  };

  // Handler to update target audience
  const handleUpdateTargetAudience = async (updatedData: {
    primary: string;
    affluence: string;
    occasions: string;
  }) => {
    if (!idParam) return;

    try {
      await updateScreenAPI(idParam, {
        campaign_insights: {
          ...screen.campaign_insights,
          target_audience: updatedData,
        }
      });

      // Update local state using functional form to avoid stale state
      setScreen((prevScreen: any) => ({
        ...prevScreen,
        campaign_insights: {
          ...prevScreen.campaign_insights,
          target_audience: updatedData,
        }
      }));

      toast.success("Target audience updated successfully");
    } catch (error) {
      console.error("Error updating target audience:", error);
      toast.error("Failed to update target audience");
      throw error;
    }
  };

  // Handler to update description
  const handleUpdateDescription = async (description: string) => {
    if (!idParam) return;

    try {
      await updateScreenAPI(idParam, {
        description: description,
      });

      // Update local state using functional form to avoid stale state
      setScreen((prevScreen: any) => ({
        ...prevScreen,
        description: description,
      }));
    } catch (error) {
      console.error("Error updating description:", error);
      throw error;
    }
  };

  // Handler to update screen name
  const handleUpdateScreenName = async (screenName: string) => {
    if (!idParam) return;

    try {
      await updateScreenAPI(idParam, {
        screen_name: screenName,
      });

      // Update local state using functional form to avoid stale state
      setScreen((prevScreen: any) => ({
        ...prevScreen,
        screen_name: screenName,
      }));
    } catch (error) {
      console.error("Error updating screen name:", error);
      throw error;
    }
  };

  // Handler to update cafe name
  const handleUpdateCafeName = async (cafeName: string) => {
    if (!idParam) return;

    try {
      await updateScreenAPI(idParam, {
        cafe_name: cafeName,
      });

      // Update local state using functional form to avoid stale state
      setScreen((prevScreen: any) => ({
        ...prevScreen,
        cafe_name: cafeName,
      }));

      toast.success("Cafe name updated successfully");
    } catch (error) {
      console.error("Error updating cafe name:", error);
      toast.error("Failed to update cafe name");
      throw error;
    }
  };

  // Handler to update categories
  const handleUpdateCategories = async (updatedCategories: string[]) => {
    if (!idParam) return;

    try {
      await updateScreenAPI(idParam, {
        campaign_insights: {
          ...screen.campaign_insights,
          use_cases: updatedCategories,
        }
      });

      // Update local state using functional form to avoid stale state
      setScreen((prevScreen: any) => ({
        ...prevScreen,
        campaign_insights: {
          ...prevScreen.campaign_insights,
          use_cases: updatedCategories,
        }
      }));
    } catch (error) {
      console.error("Error updating categories:", error);
      throw error;
    }
  };

  if (loading) {
    return (
      <div className="relative min-h-screen flex items-center justify-center transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <Loader2 className="w-8 h-8 animate-spin transition-colors duration-300" style={{ color: 'var(--text-primary)' }} />
      </div>
    );
  }

  if (!screen) {
    return (
      <div className="relative min-h-screen flex items-center justify-center transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Screen not found</p>
      </div>
    );
  }

  // Map API data to component props
  const screenName = (screen as any).screen_name || screen.venue_name || "Unnamed Screen";

  // Debug: Log the full location object
  console.log("Full screen.location object:", screen.location);

  // Ignore "Unknown" as a valid city value
  const city = (screen.location?.city && screen.location.city !== "Unknown") ? screen.location.city : "";
  const street = (screen.location as any)?.street || screen.location?.address?.full_address || "";
  const state = screen.location?.state || "";
  const country = (screen.location as any)?.country || "";

  console.log("Extracted values - city:", city, "street:", street, "state:", state, "country:", country);

  // Build location string: if we have a valid city, use city/state/country, otherwise use street address
  const locationParts = [city, state, country].filter(Boolean);
  const location = (city && locationParts.length > 0)
    ? locationParts.join(", ")
    : (street || "Location not specified");
  const description = (screen as any).description || "";
  const price = (screen as any).pricing?.price || 0;
  const currency = (screen as any).pricing?.currency || "INR";
  const unit = (screen as any).pricing?.unit || "per week";
  const priceNote = `Starting ${currency === "INR" ? "₹" : "$"}${price.toLocaleString()} / ${unit}`;
  
  // Get images
  const screenImages = (screen as any).screen_images || [];
  const mediaGalleryImages = screen.media_gallery?.filter((m: any) => m.type === "image").map((m: any) => m.url) || [];
  const gallery = screenImages.length > 0 ? screenImages : mediaGalleryImages;
  const heroImage = activeImage || gallery[0] || "";
  
  // Get campaign insights from API or use defaults
  const campaignInsights = (screen as any).campaign_insights || {};
  const operationalInfo = (screen as any).operational_info || {};
  const technicalDetails = (screen as any).technical_details || {};

  // Build highlights from API benefits or use defaults
  const highlights = campaignInsights.benefits || [
    "High visibility digital display",
    "Real-time content updates",
    "Premium audience reach"
  ];

  // Build categories from API or use defaults
  const categories = campaignInsights.use_cases?.slice(0, 3) || DEFAULT_CATEGORIES;

  // Build metrics from API data
  const weeklyFootfall = campaignInsights.weekly_footfall || 15000;
  const weeklyFootfallDisplay = campaignInsights.weekly_footfall_display || `${weeklyFootfall.toLocaleString()}/week`;
  const avgDwellTime = campaignInsights.average_dwell_min || 20;

  // Extract pricing data and calculate dynamic rates using centralized utility
  const baseHourlyRate = calculateBaseHourlyRate((screen as any).pricing);

  // Get frequency discounts from API or default to 0% for all
  const frequencyDiscounts = (screen as any).pricing?.frequency_discounts || {
    hourly: 0,
    daily: 0,
    weekly: 0,
    fortnightly: 0,
    monthly: 0,
  };

  // Calculate rates for all frequencies with discounts
  const calculatedRates = calculateFrequencyRates(baseHourlyRate, frequencyDiscounts);

  // Get the current rate based on selected frequency
  const currentRate = calculatedRates[selectedFrequency];

  // Create screen object for components matching ScreenDetail type
  const screenForComponents = {
    id: screen._id,
    name: screenName,
    cafe_name: (screen as any).cafe_name || screenName,
    location: location,
    street: street,
    city: city,
    state: state,
    country: country,
    basePrice: price,
    priceUnit: unit,
    rating: operationalInfo.rating || 4.8,
    reviews: operationalInfo.verified_reviews || 44,
    hero: heroImage,
    gallery: gallery.length > 0 ? gallery : [heroImage || "/background.jpg"],
    priceNote: priceNote,
    description: description || `Digital display screen located at ${city}. ${technicalDetails.resolution || '1920x1080'} resolution, ${technicalDetails.orientation || 'landscape'} orientation.`,
    highlights: highlights,
    categories: categories,
    variants: DEFAULT_VARIANTS.map(v => ({ ...v, price: price })),
    frequencies: DEFAULT_FREQUENCIES.map(f => ({ ...f, savings: "" })),
    metrics: {
      footfall: weeklyFootfallDisplay,
      dwell: `${avgDwellTime} min`,
      audience: `${Math.round(weeklyFootfall * 0.6 / 1000)}K/week`,
    },
    venue: {
      hours: operationalInfo.operating_hours || "8:00 AM - 10:00 PM",
      dailyVisitors: operationalInfo.avg_daily_visitors || "3 min, 10 secs Loop",
      screenPosition: operationalInfo.screen_position || "43",
      environment: operationalInfo.environment || "Indoor, well‑lit, dwell time 20–40 minutes per visit",
    },
    targetAudience: campaignInsights.target_audience || {
      primary: "22–40 yrs, working professionals, students, young families",
      affluence: "Mid to upper‑middle income, frequent café visitors",
      occasions: "Coffee breaks, casual meetings, remote work, evening hangouts",
    },
    technicalDetails: {
      resolution: technicalDetails.resolution || `${technicalDetails.width || 1920}x${technicalDetails.height || 1080}`,
      orientation: technicalDetails.orientation || "landscape",
      size: technicalDetails.size || "55 inch",
    },
    online: (screen as any).online || false,
    status: (screen as any).status || "active",
  };

  return (
    <div className="relative min-h-screen transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_45%)] opacity-70 dark:opacity-70 light:opacity-30" />

      <div className="relative z-10 w-[92%] md:w-[85%] mx-auto pt-28 pb-20 space-y-10">
        <div className="flex items-center gap-4 text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
          <Link
            href="/browse-screens"
            className="inline-flex items-center gap-2 transition-colors duration-300 hover:opacity-80"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ArrowLeft className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
            Back to Browse
          </Link>
          <span className="transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>/</span>
          <span className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>{city}</span>
        </div>

        <div className="grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-7 space-y-6">
            <ScreenGallery screen={screenForComponents} activeImage={activeImage} setActiveImage={setActiveImage} />
            {isAdmin ? (
              <EditableScreenMetrics
                metrics={screenForComponents.metrics}
                screenId={idParam || ""}
                isAdmin={isAdmin}
                location={location}
                onUpdate={handleUpdateMetrics}
              />
            ) : (
              <ScreenMetricsGrid metrics={screenForComponents.metrics} location={location} />
            )}
            {isAdmin ? (
              <EditableScreenInsights
                description={screenForComponents.description}
                highlights={screenForComponents.highlights}
                screenId={idParam || ""}
                isAdmin={isAdmin}
                onUpdate={handleUpdateInsights}
              />
            ) : (
              <ScreenInsights description={screenForComponents.description} highlights={screenForComponents.highlights} />
            )}
          </div>

          {/* Right column */}
          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-3xl border p-6 space-y-6 transition-colors duration-300" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-card)' }}>
              {isAdmin ? (
                <EditableScreenOverview
                  screen={screenForComponents}
                  screenId={idParam || ""}
                  isAdmin={isAdmin}
                  description={description}
                  onUpdate={handleUpdateRatingReviews}
                  onUpdateLocation={handleUpdateLocation}
                  onUpdateDescription={handleUpdateDescription}
                  onUpdateScreenName={handleUpdateScreenName}
                  onUpdateCafeName={handleUpdateCafeName}
                />
              ) : (
                <ScreenOverviewCard screen={screenForComponents} />
              )}

              <div className="rounded-2xl border p-4 space-y-2 transition-colors duration-300" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
                <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Estimated cost</p>
                <div className="flex items-center gap-2">
                  <p className="text-3xl font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                    {formatPrice(currentRate.price, currency)}
                  </p>
                  {currentRate.discount_percent > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                      Save {currentRate.discount_percent}%
                    </span>
                  )}
                </div>
                <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  per {FREQUENCY_UNIT_LABELS[selectedFrequency]}
                </p>
            
              </div>

              <div className="space-y-2">
                <p className="text-sm uppercase tracking-widest transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  Duration
                </p>
                <Select
                  value={selectedFrequency}
                  onValueChange={(value: PricingFrequency) => setSelectedFrequency(value)}
                >
                  <SelectTrigger className="w-full h-12 rounded-2xl border transition-colors duration-300 hover:opacity-80" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                    <SelectValue placeholder="Select duration" />
                  </SelectTrigger>
                  <SelectContent className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
                    <SelectItem value="hourly" className="transition-colors duration-300 hover:opacity-80" style={{ color: 'var(--text-primary)' }}>
                      Per Hour
                    </SelectItem>
                    <SelectItem value="daily" className="transition-colors duration-300 hover:opacity-80" style={{ color: 'var(--text-primary)' }}>
                      Per Day
                    </SelectItem>
                    <SelectItem value="weekly" className="transition-colors duration-300 hover:opacity-80" style={{ color: 'var(--text-primary)' }}>
                      Per Week
                    </SelectItem>
                    <SelectItem value="fortnightly" className="transition-colors duration-300 hover:opacity-80" style={{ color: 'var(--text-primary)' }}>
                      Per Fortnight
                    </SelectItem>
                    <SelectItem value="monthly" className="transition-colors duration-300 hover:opacity-80" style={{ color: 'var(--text-primary)' }}>
                      Per Month
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isAdmin ? (
                <EditableScreenCategoryBadges
                  categories={screenForComponents.categories}
                  screenId={idParam || ""}
                  isAdmin={isAdmin}
                  onUpdate={handleUpdateCategories}
                />
              ) : (
                <ScreenCategoryBadges categories={screenForComponents.categories} />
              )}

              <div className="space-y-3">
                <button
                  onClick={() => {
                    if (user) {
                      // User is logged in, navigate directly to booking page
                      router.push(`/screens/${idParam}/book-campaign`);
                    } else {
                      // User is not logged in, show login dialog
                      setShowLoginDialog(true);
                    }
                  }}
                  className="w-full rounded-2xl py-4 text-lg font-semibold shadow-lg transition-all duration-300 hover:-translate-y-0.5"
                  style={{
                    backgroundColor: 'var(--text-primary)',
                    color: 'var(--text-inverse)'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '0.95'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  Start Campaign
                </button>

              </div>
            </div>

            {isAdmin ? (
              <EditableScreenVenueSnapshot
                venue={screenForComponents.venue}
                screenId={idParam || ""}
                isAdmin={isAdmin}
                onUpdate={handleUpdateVenueSnapshot}
              />
            ) : (
              <ScreenVenueSnapshotCard venue={screenForComponents.venue} />
            )}

            {/* Target Audience Card */}
            {isAdmin ? (
              <EditableTargetAudienceCard
                data={screenForComponents.targetAudience}
                screenId={idParam || ""}
                isAdmin={isAdmin}
                onUpdate={handleUpdateTargetAudience}
              />
            ) : (
              <TargetAudienceCard data={screenForComponents.targetAudience} />
            )}
          </div>
        </div>
      </div>
      <StartCampaignDialog open={showLoginDialog} onOpenChange={setShowLoginDialog} screenId={idParam || undefined} />
    </div>
  );
};

export default ScreensDetailedPage;