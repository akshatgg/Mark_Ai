"use client";
import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Search, MapPin, X, Check, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getPublicScreens, type Screen } from '@/services/screenService';
import { formatPrice, calculateBaseHourlyRate } from '@/lib/pricingUtils';
import toast from 'react-hot-toast';

interface ScreenSelectorProps {
  currentScreenId: string;
  selectedScreenIds: Set<string>;
  onToggleScreen: (screen: Screen) => void;
  onSelectAll: (screens: Screen[]) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const ScreenSelector: React.FC<ScreenSelectorProps> = ({
  currentScreenId,
  selectedScreenIds,
  onToggleScreen,
  onSelectAll,
  isOpen,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [screens, setScreens] = useState<Screen[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScreens = async () => {
      try {
        setLoading(true);
        const response = await getPublicScreens(100, 0, "active");
        setScreens(response.screens || []);
      } catch (error) {
        console.error("Error fetching screens:", error);
        toast.error("Failed to load screens");
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      fetchScreens();
    }
  }, [isOpen]);

  // Filter screens
  const filteredScreens = useMemo(() => {
    return screens.filter(screen => {
      const screenName = ((screen as any).screen_name || screen.venue_name || "").toLowerCase();
      const city = (screen.location?.city || "").toLowerCase();
      const street = ((screen.location as any)?.street || screen.location?.address?.full_address || "").toLowerCase();
      const query = searchQuery.toLowerCase();
      
      const matchesSearch = screenName.includes(query) || city.includes(query) || street.includes(query);
      
      return matchesSearch;
    });
  }, [screens, searchQuery]);

  const selectedCount = selectedScreenIds.size;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop for mobile */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />

          {/* Sidebar */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className={cn(
              "fixed right-0 top-0 h-full w-full sm:w-[400px] lg:w-[450px]",
              "z-50 transition-colors duration-300",
              "flex flex-col overflow-hidden"
            )}
            style={{ backgroundColor: 'var(--bg-primary)', borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: 'var(--border-primary)' }}
          >
            {/* Header */}
            <div className="p-4 md:p-6 backdrop-blur-md transition-colors duration-300" style={{ borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'var(--border-primary)', backgroundColor: 'var(--bg-card)' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl md:text-2xl font-bold heading-font transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                    Select Screens
                  </h2>
                  <p className="text-sm mt-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                    {selectedCount} screen{selectedCount !== 1 ? 's' : ''} selected
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className={cn(
                    "p-2 rounded-lg transition-all duration-300"
                  )}
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                <input
                  type="text"
                  placeholder="Search screens..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn(
                    "w-full pl-10 pr-4 py-2.5 rounded-lg text-sm",
                    "backdrop-blur-md",
                    "focus:outline-none transition-all duration-300"
                  )}
                  style={{ backgroundColor: 'var(--bg-card)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* Select All Button */}
              <button
                onClick={() => onSelectAll(filteredScreens)}
                disabled={loading || filteredScreens.length === 0}
                className={cn(
                  "w-full mt-3 py-2.5 px-4 rounded-lg text-sm font-medium",
                  "bg-linear-to-r from-purple-600 to-purple-500",
                  "hover:from-purple-500 hover:to-purple-400",
                  "transition-all duration-300",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  "flex items-center justify-center gap-2"
                )}
                style={{ color: 'var(--text-primary)' }}
              >
                <Check className="w-4 h-4" />
                {selectedScreenIds.size === filteredScreens.length && filteredScreens.length > 0
                  ? `Deselect All (${filteredScreens.length})`
                  : `Select All (${filteredScreens.length})`}
              </button>
            </div>

            {/* Screen List */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                </div>
              ) : filteredScreens.length === 0 ? (
                <div className="text-center py-12">
                  <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>No screens found</p>
                </div>
              ) : (
                filteredScreens.map((screen) => {
                  const screenName = (screen as any).screen_name || screen.venue_name || "Unnamed Screen";
                  const city = screen.location?.city || "Unknown";
                  const street = (screen.location as any)?.street || screen.location?.address?.full_address || "";
                  const location = street ? `${street}, ${city}` : city;
                  const imageUrl = (screen as any).screen_images?.[0] || screen.media_gallery?.[0]?.url || "/background.jpg";
                  
                  const pricing = (screen as any).pricing || {};
                  const baseHourlyRate = calculateBaseHourlyRate(pricing);
                  const currency = pricing.currency || "INR";

                  const isSelected = selectedScreenIds.has(screen._id);
                  const isCurrent = screen._id === currentScreenId;

                  return (
                    <motion.div
                      key={screen._id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "relative rounded-xl overflow-hidden border transition-all duration-300 cursor-pointer",
                        "backdrop-blur-md",
                        isSelected
                          ? "border-purple-500 shadow-lg shadow-purple-500/20"
                          : "",
                        isCurrent && "ring-2 ring-blue-500"
                      )}
                      style={!isSelected && !isCurrent ? { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' } : isSelected ? { backgroundColor: 'var(--bg-card)' } : {}}
                      onClick={() => !isCurrent && onToggleScreen(screen)}
                    >
                      {/* Selected Badge */}
                      <AnimatePresence>
                        {isSelected && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center"
                          >
                            <Check className="w-4 h-4 text-white" />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Current Screen Badge */}
                      {isCurrent && (
                        <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded-full bg-blue-500 text-xs font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                          Current
                        </div>
                      )}

                      <div className="flex gap-3 p-3">
                        {/* Image */}
                        <div className="relative w-20 h-20 rounded-lg overflow-hidden shrink-0 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)' }}>
                          <Image
                            src={imageUrl}
                            alt={screenName}
                            fill
                            className="object-cover"
                            unoptimized
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "/background.jpg";
                            }}
                          />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold mb-1 truncate transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                            {screenName}
                          </h3>

                          <div className="flex items-start gap-1 mb-2">
                            <MapPin className="w-3 h-3 shrink-0 mt-0.5 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                            <p className="text-xs line-clamp-2 leading-tight transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                              {location}
                            </p>
                          </div>

                          <div className="flex items-baseline gap-1">
                            <span className="text-base font-bold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                              {formatPrice(baseHourlyRate, currency)}
                            </span>
                            <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>/hour</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-4 md:p-6 backdrop-blur-md transition-colors duration-300" style={{ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border-primary)', backgroundColor: 'var(--bg-card)' }}>
              <button
                onClick={onClose}
                className={cn(
                  "w-full px-6 py-3 rounded-lg font-semibold text-sm",
                  "bg-linear-to-r from-purple-600 to-pink-600",
                  "hover:from-purple-700 hover:to-pink-700",
                  "transition-all duration-300 shadow-lg hover:shadow-xl"
                )}
                style={{ color: 'var(--text-primary)' }}
              >
                Continue with {selectedCount} Screen{selectedCount !== 1 ? 's' : ''}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
