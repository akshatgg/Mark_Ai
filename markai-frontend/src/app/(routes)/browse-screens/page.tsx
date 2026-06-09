"use client";
import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { MapPin, Eye, Search, Filter, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { containerVariants, itemVariants, headlineVariants } from '@/utility/animations';
import { getPublicScreens, type Screen } from '@/services/screenService';
import { ScreenSearchBar } from '@/components/common/ScreenSearchBar';
import GoogleMapsEmbed from '@/components/home/GoogleMapsEmbed';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import toast from 'react-hot-toast';
import { formatPrice, calculateBaseHourlyRate } from '@/lib/pricingUtils';

const SCREENS_PER_PAGE = 9;

const BrowseScreensPage = () => {
    const [screens, setScreens] = useState<Screen[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState("");
    const [totalCount, setTotalCount] = useState(0);
    const [totalPages, setTotalPages] = useState(0);

    useEffect(() => {
        const fetchScreens = async () => {
            try {
                setLoading(true);
                const skip = (currentPage - 1) * SCREENS_PER_PAGE;
                // Fetch screens with search parameter
                const response = await getPublicScreens(SCREENS_PER_PAGE, skip, "active", undefined, searchTerm);

                const screensData = response.screens || [];
                setScreens(screensData);

                // Use pagination object if available, otherwise fallback to count
                if (response.pagination) {
                    const total = response.pagination.total || 0;
                    const pages = response.pagination.pages || Math.ceil(total / SCREENS_PER_PAGE);
                    setTotalCount(total);
                    setTotalPages(pages);
                } else {
                    // Legacy support
                    const count = response.count || 0;
                    setTotalCount(count);
                    setTotalPages(Math.ceil(count / SCREENS_PER_PAGE));
                }
            } catch (error) {
                console.error("Error fetching screens:", error);
                toast.error("Failed to load screens");
            } finally {
                setLoading(false);
            }
        };

        // Reset to page 1 when search term changes
        if (searchTerm !== "") {
            setCurrentPage(1);
        }
        fetchScreens();
    }, [currentPage, searchTerm]);

    return (
        <div className="relative w-full min-h-screen overflow-hidden bg-white dark:bg-[#0a0e1a] transition-colors duration-300">
            <div
                aria-hidden
                className="pointer-events-none absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full blur-3xl opacity-30"
                style={{ background: "radial-gradient(circle, var(--brand-blue) 0%, transparent 70%)" }}
            />
            <div
                aria-hidden
                className="pointer-events-none absolute top-1/4 -right-32 h-[520px] w-[520px] rounded-full blur-3xl opacity-25"
                style={{ background: "radial-gradient(circle, var(--brand-cyan) 0%, transparent 70%)" }}
            />
            <div
                aria-hidden
                className="pointer-events-none absolute bottom-0 left-1/4 h-[320px] w-[320px] rounded-full blur-3xl opacity-20"
                style={{ background: "radial-gradient(circle, var(--brand-lime) 0%, transparent 70%)" }}
            />

            <div className="relative z-10 pt-32 pb-20 md:pt-40 md:pb-28">
                <div className="w-[90%] md:w-[85%] mx-auto px-4 md:px-0">
                    <motion.div
                        className="text-center space-y-6 mb-12"
                        variants={containerVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true, margin: "-100px" }}
                    >
                        <motion.span
                            className="inline-flex items-center gap-2 rounded-full border border-base bg-surface/70 px-4 py-1.5 text-xs font-medium text-subtle backdrop-blur"
                            variants={itemVariants}
                        >
                            <span className="h-2 w-2 rounded-full" style={{ background: "var(--brand-green)" }} />
                            1,500+ premium screens across India
                        </motion.span>
                        <motion.h1
                            className="text-3xl md:text-5xl lg:text-6xl xl:text-7xl font-bold heading-font tracking-tight text-base"
                            variants={headlineVariants}
                        >
                            Browse{" "}
                            <span
                                className="bg-clip-text text-transparent"
                                style={{
                                    backgroundImage:
                                        "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 55%, var(--brand-green) 100%)",
                                }}
                            >
                                Screens
                            </span>
                        </motion.h1>
                        <motion.p
                            className="text-base md:text-lg lg:text-xl max-w-3xl mx-auto px-4 md:px-0 text-muted"
                            variants={itemVariants}
                        >
                            Discover available digital screens across major cities. Book your campaign in minutes.
                        </motion.p>
                    </motion.div>

                    {/* Search and Filter Bar */}
                    <motion.div
                        className="mb-8 md:mb-12"
                        variants={itemVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                    >
                        <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch md:items-center">
                            <div className="flex-1 w-full">
                                <ScreenSearchBar
                                    onSearch={setSearchTerm}
                                    placeholder="Search by screen name, location, or city..."
                                    className="w-full"
                                    debounceMs={500}
                                />
                            </div>
                            <button
                                className="px-5 md:px-6 py-3 md:py-4 rounded-full font-semibold text-sm md:text-base border border-base bg-surface/70 text-base backdrop-blur transition hover:bg-elev flex items-center justify-center gap-2"
                            >
                                <Filter className="w-4 h-4 md:w-5 md:h-5" />
                                Filter
                            </button>
                        </div>
                    </motion.div>

                    {/* Results Count */}
                    <motion.div
                        className="mb-6 md:mb-8"
                        variants={itemVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                    >
                        <p className="text-sm md:text-base transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                            {searchTerm ? (
                                <>
                                    Found <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {totalCount}
                                    </span> results for "{searchTerm}"
                                    {currentPage > 1 && (
                                        <span style={{ color: 'var(--text-tertiary)' }}> (Page {currentPage} of {totalPages})</span>
                                    )}
                                </>
                            ) : (
                                <>
                                    Showing <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {loading ? 0 : screens.length}
                                    </span> of <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{totalCount}</span> screens
                                    {currentPage > 1 && (
                                        <span style={{ color: 'var(--text-tertiary)' }}> (Page {currentPage} of {totalPages})</span>
                                    )}
                                </>
                            )}
                        </p>
                    </motion.div>

                    {/* Screen Cards Grid */}
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 animate-spin transition-colors duration-300" style={{ color: 'var(--text-primary)' }} />
                        </div>
                    ) : screens.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <Search className="w-16 h-16 mb-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                            <h3 className="text-xl font-semibold mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                                {searchTerm ? "No screens found matching your search" : "No screens available"}
                            </h3>
                            <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                                {searchTerm ? "Try a different search term" : "Check back later for available screens"}
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 lg:gap-8">
                            {screens.map((screen) => {
                                const screenName = (screen as any).screen_name || screen.venue_name || "Unnamed Screen";
                                const city = screen.location?.city || "Unknown";
                                const street = (screen.location as any)?.street || screen.location?.address?.full_address || "";
                                const location = street ? `${street}, ${city}` : city;
                                const imageUrl = (screen as any).screen_images?.[0] || screen.media_gallery?.[0]?.url || "/background.jpg";

                                // Get dynamic pricing using centralized utility
                                const pricing = (screen as any).pricing || {};
                                const baseHourlyRate = calculateBaseHourlyRate(pricing);
                                const currency = pricing.currency || "INR";

                                return (
                                    <motion.div
                                        key={screen._id}
                                        variants={itemVariants}
                                        initial="hidden"
                                        whileInView="visible"
                                        viewport={{ once: true, margin: "-50px" }}
                                        whileHover={{ scale: 1.02, y: -5 }}
                                        transition={{ type: "spring", stiffness: 300 }}
                                        className="rounded-2xl overflow-hidden backdrop-blur-md border transition-all duration-300 group cursor-pointer"
                                        style={{
                                            backgroundColor: 'var(--bg-card)',
                                            borderColor: 'var(--border-primary)'
                                        }}
                                    >
                                        {/* Image Container */}
                                        <div className="relative w-full h-48 md:h-64 overflow-hidden bg-[#1a1a1a]">
                                            <Image
                                                src={imageUrl}
                                                alt={screenName}
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
                                                <span className="px-3 py-1 rounded-full backdrop-blur-md border text-sm font-medium transition-colors duration-300" style={{
                                                    backgroundColor: 'var(--bg-card)',
                                                    borderColor: 'var(--border-primary)',
                                                    color: 'var(--text-primary)'
                                                }}>
                                                    {city}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Content */}
                                        <div className="p-4 md:p-6">
                                            <h3 className="text-lg md:text-xl font-bold mb-2 heading-font line-clamp-1 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                                                {screenName}
                                            </h3>

                                            <div className="flex items-start gap-2 mb-3 md:mb-4">
                                                <MapPin className="w-4 h-4 md:w-5 md:h-5 shrink-0 mt-0.5 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                                                <p className="text-xs md:text-sm leading-relaxed line-clamp-2 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                                                    {location}
                                                </p>
                                            </div>

                                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-0 pt-4 border-t transition-colors duration-300" style={{ borderTopColor: 'var(--border-primary)' }}>
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
                                                    className="brand-gradient-bg w-full md:w-auto px-5 md:px-6 py-2.5 md:py-3 rounded-full font-semibold text-xs md:text-sm text-white transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 flex items-center justify-center gap-2"
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

                    {/* Pagination - Show based on server-side pagination, not filtered results */}
                    {!loading && totalPages > 1 && (
                        <div className="mt-12 flex justify-center">
                            <Pagination>
                                <PaginationContent className="gap-1">
                                    <PaginationItem>
                                        <PaginationPrevious
                                            href="#"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                if (currentPage > 1) {
                                                    setCurrentPage(currentPage - 1);
                                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                                }
                                            }}
                                            className={cn(
                                                "border transition-colors duration-300",
                                                currentPage === 1 && "pointer-events-none opacity-50"
                                            )}
                                            style={{
                                                color: 'var(--text-primary)',
                                                borderColor: 'var(--border-primary)'
                                            }}
                                        />
                                    </PaginationItem>

                                    {/* Page Numbers */}
                                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                                        // Show first page, last page, current page, and pages around current
                                        const showPage =
                                            pageNum === 1 ||
                                            pageNum === totalPages ||
                                            (pageNum >= currentPage - 1 && pageNum <= currentPage + 1);

                                        if (!showPage) {
                                            // Show ellipsis
                                            if (
                                                (pageNum === currentPage - 2 && currentPage > 3) ||
                                                (pageNum === currentPage + 2 && currentPage < totalPages - 2)
                                            ) {
                                                return (
                                                    <PaginationItem key={`ellipsis-${pageNum}`}>
                                                        <PaginationEllipsis className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                                                    </PaginationItem>
                                                );
                                            }
                                            return null;
                                        }

                                        return (
                                            <PaginationItem key={pageNum}>
                                                <PaginationLink
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        setCurrentPage(pageNum);
                                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                                    }}
                                                    isActive={currentPage === pageNum}
                                                    className="min-w-10 border transition-all duration-300"
                                                    style={{
                                                        color: currentPage === pageNum ? 'var(--text-inverse)' : 'var(--text-primary)',
                                                        backgroundColor: currentPage === pageNum ? 'var(--text-primary)' : 'transparent',
                                                        borderColor: currentPage === pageNum ? 'var(--text-primary)' : 'var(--border-primary)'
                                                    }}
                                                >
                                                    {pageNum}
                                                </PaginationLink>
                                            </PaginationItem>
                                        );
                                    })}

                                    <PaginationItem>
                                        <PaginationNext
                                            href="#"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                if (currentPage < totalPages) {
                                                    setCurrentPage(currentPage + 1);
                                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                                }
                                            }}
                                            className={cn(
                                                "border transition-colors duration-300",
                                                currentPage === totalPages && "pointer-events-none opacity-50"
                                            )}
                                            style={{
                                                color: 'var(--text-primary)',
                                                borderColor: 'var(--border-primary)'
                                            }}
                                        />
                                    </PaginationItem>
                                </PaginationContent>
                            </Pagination>
                        </div>
                    )}
                </div>
            </div>

            {/* Google Maps Section */}
            <GoogleMapsEmbed
                title="Find Screens Near You"
                description="Explore our interactive map to discover all available digital screens in your area. Click on any marker to get more details."
                mapId="1nmvPRNvI2rFnUkQ9QqHJPBmOXj-2hg0"
                height="600"
            />
        </div>
    );
};

export default BrowseScreensPage;
