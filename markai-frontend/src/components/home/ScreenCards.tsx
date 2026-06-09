"use client";
import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { MapPin, Eye, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { containerVariants, itemVariants, headlineVariants } from '@/utility/animations';
import { getPublicScreens } from '@/services/screenService';
import { formatPrice } from '@/lib/pricingUtils';

// Screen type from Xibo API (via backend)
interface XiboScreen {
    _id: string;
    screen_name?: string;
    description?: string;
    screen_images?: string[];
    location?: {
        street?: string;
        city?: string;
        country?: string;
        latitude?: number;
        longitude?: number;
    };
    technical_details?: {
        width?: number;
        height?: number;
        size?: string;
        orientation?: string;
        mac_address?: string;
        client_address?: string;
    };
    pricing?: {
        price?: number;
        currency?: string;
        unit?: string;
        base_hourly_rate?: number;
    };
    xibo_display_id?: number;
    xibo_sync_data?: Record<string, any>;
    status?: string;
    online?: boolean;
    source?: string;
}

const ScreenCards = () => {
    const [screens, setScreens] = useState<XiboScreen[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchScreens = async () => {
            try {
                setLoading(true);
                // Fetch all screens from backend - returns real-time Xibo data
                const response = await getPublicScreens(6, 0, "active");
                setScreens(response.screens || []);
            } catch (error) {
                console.error("Error fetching screens:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchScreens();
    }, []);
    return (
    <section className="relative w-full py-10 overflow-hidden transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)' }}>
        {/* Subtle background pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[50px_50px] opacity-50" />

        <div className="relative z-10 w-[90%] md:w-[85%] mx-auto">
            {/* Header */}
            <motion.div
                className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 md:mb-12 gap-4"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-100px" }}
            >
                <motion.div variants={headlineVariants}>
                    <h2 className="text-3xl md:text-5xl lg:text-6xl font-bold heading-font transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                        Featured Screens
                    </h2>
                </motion.div>

                <motion.div variants={itemVariants} className="w-full md:w-auto">
                    <Link
                        href="/browse-screens"
                        className={cn(
                            "flex items-center gap-2 text-base md:text-lg font-semibold",
                            "transition-colors duration-300"
                        )}
                        style={{ color: 'var(--text-primary)' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-purple)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                    >
                        View all screens
                        <span className="text-purple-400">→</span>
                    </Link>
                </motion.div>
            </motion.div>

            {/* Screen Cards Grid */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin transition-colors duration-300" style={{ color: 'var(--text-primary)' }} />
                </div>
            ) : screens.length === 0 ? (
                <div className="text-center py-20">
                    <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>No screens available</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                    {screens.map((screen) => {
                        const imageUrl = screen.screen_images?.[0] || "/background.jpg";
                        const city = screen.location?.city || "Unknown";
                        const locationText = screen.location?.street
                            ? `${screen.location.street}, ${city}`
                            : city;
                        const isOnline = screen.online ?? screen.xibo_sync_data?.logged_in;
                        const isXibo = screen.source === 'xibo';

                        // Get dynamic pricing from base_hourly_rate set by admin
                        let baseHourlyRate = screen.pricing?.base_hourly_rate;

                        // Backward compatibility: Calculate base hourly rate from legacy weekly price if not available
                        if (!baseHourlyRate && screen.pricing?.price) {
                            const unit = screen.pricing.unit || "per week";
                            if (unit.includes("week")) {
                                // Assume legacy price is per week (168 hours)
                                baseHourlyRate = Math.round(screen.pricing.price / 168);
                            } else if (unit.includes("day")) {
                                baseHourlyRate = Math.round(screen.pricing.price / 24);
                            } else if (unit.includes("month")) {
                                baseHourlyRate = Math.round(screen.pricing.price / 720);
                            } else {
                            baseHourlyRate = screen.pricing.price;
                            }
                        }

                        // Default to a reasonable rate if nothing is available
                        if (!baseHourlyRate) {
                            baseHourlyRate = 30;
                        }

                        const currency = screen.pricing?.currency || "INR";

                        return (
                            <motion.div
                                key={screen._id}
                                variants={itemVariants}
                                initial="hidden"
                                whileInView="visible"
                                viewport={{ once: true, margin: "-50px" }}
                                whileHover={{ scale: 1.02, y: -5 }}
                                transition={{ type: "spring", stiffness: 300 }}
                                className={cn(
                                    "rounded-2xl overflow-hidden backdrop-blur-md",
                                    "transition-all duration-300",
                                    "group cursor-pointer"
                                )}
                                style={{
                                    backgroundColor: 'var(--bg-card)',
                                    borderColor: 'var(--border-primary)',
                                    borderWidth: '1px',
                                    borderStyle: 'solid'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--border-secondary)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--border-primary)';
                                }}
                            >
                                {/* Image Container */}
                                <div className="relative w-full h-48 md:h-64 overflow-hidden bg-[#1a1a1a]">
                                    <Image
                                        src={imageUrl}
                                        alt={screen.screen_name || "Screen"}
                                        fill
                                        className="object-cover transition-transform duration-300 group-hover:scale-110"
                                        quality={90}
                                        unoptimized
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).src = "/background.jpg";
                                        }}
                                    />
                                    <div className="absolute inset-0 bg-linear-to-t from-black/60 via-black/20 to-transparent" />

                                    {/* City Badge */}
                                    <div className="absolute top-4 left-4">
                                        <span className="px-3 py-1 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                                            {city}
                                        </span>
                                    </div>

                                    {/* Online Status Badge (for Xibo screens) */}
                                    {isXibo && (
                                        <div className="absolute top-4 right-4">
                                            <span className={cn(
                                                "px-2 py-1 rounded-full text-xs font-medium",
                                                isOnline
                                                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                                    : "bg-red-500/20 text-red-400 border border-red-500/30"
                                            )}>
                                                {isOnline ? "Online" : "Offline"}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Content */}
                                <div className="p-4 md:p-6">
                                    <h3 className="text-lg md:text-xl font-bold mb-2  line-clamp-1 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                                        {screen.screen_name}
                                    </h3>

                                    <div className="flex items-start gap-2 mb-3 md:mb-4">
                                        <MapPin className="w-4 h-4 md:w-5 md:h-5 shrink-0 mt-0.5 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                                        <p className="text-xs md:text-sm leading-relaxed line-clamp-2 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                                            {locationText}
                                        </p>
                                    </div>

                                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-0 pt-4 transition-colors duration-300" style={{ borderTopColor: 'var(--border-primary)', borderTopWidth: '1px', borderTopStyle: 'solid' }}>
                                        <div>
                                            <p className="text-xs mb-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Starting from</p>
                                            <p className="text-xl md:text-2xl font-bold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                                                {formatPrice(baseHourlyRate, currency)}
                                                <span className="text-xs md:text-sm font-normal transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>/hour</span>
                                            </p>
                                        </div>

                                        <Link
                                            href={`/screens/${screen._id}`}
                                            onClick={(e) => e.stopPropagation()}
                                            className={cn(
                                                "brand-gradient-bg w-full md:w-auto px-5 md:px-6 py-2.5 md:py-3 rounded-full font-semibold text-xs md:text-sm",
                                                "transition-all duration-200",
                                                "shadow-lg hover:shadow-xl hover:scale-105",
                                                "flex items-center justify-center gap-2"
                                            )}
                                        >
                                            <Eye className="w-3 h-3 md:w-4 md:h-4" />
                                            View
                                        </Link>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </div>
    </section>
    );
};

export default ScreenCards;

