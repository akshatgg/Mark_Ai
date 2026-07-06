"use client";
import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { MapPin, ArrowRight, Building2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { containerVariants, itemVariants, headlineVariants } from '@/utility/animations';

const BrowseByCities = () => {
    return (
        <section className="relative w-full py-10 overflow-hidden transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)' }}>
            {/* Grid pattern background */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[50px_50px]" />
            {/* Theme-aware gradient backgrounds - only visible in dark mode */}
            <div className="dark:block hidden absolute inset-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(123,67,255,0.25),transparent_55%)]" />
                <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(139,92,246,0.1),transparent)]" />
            </div>
            <div className="relative z-10 w-[90%] md:w-[85%] mx-auto">
                {/* Header */}
                <motion.div
                    className="text-center mb-12 md:mb-16"
                    variants={containerVariants}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-100px" }}
                >
                    <motion.div variants={headlineVariants}>
                        <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold heading-font mb-4 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                            Now Available in Bengaluru
                        </h2>
                        <p className="text-lg md:text-xl max-w-2xl mx-auto transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                            India's tech capital, where innovation meets opportunity
                        </p>
                    </motion.div>
                </motion.div>

                {/* Featured Bengaluru Card */}
                <motion.div
                    variants={itemVariants}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-50px" }}
                    className="max-w-7xl mx-auto"
                >
                    <Link href="/browse-screens?city=Bengaluru" className="block group">
                        <motion.div
                            whileHover={{ y: -8 }}
                            transition={{ type: "spring", stiffness: 300 }}
                            className={cn(
                                "relative rounded-3xl overflow-hidden backdrop-blur-md",
                                "lg:grid lg:grid-cols-2",
                                "transition-all duration-300"
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
                            {/* Image Section */}
                            <div className="relative h-[300px] md:h-[400px] lg:h-full overflow-hidden">
                                <Image
                                    src="/cities/beng.jpg"
                                    alt="Bengaluru"
                                    fill
                                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                                    quality={90}
                                />

                                {/* Gradient Overlay */}
                                <div className="absolute inset-0 bg-linear-to-t from-black via-black/50 to-transparent" />

                                {/* Floating Badge */}
                                <div className="absolute top-6 left-6">
                                    <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/20 backdrop-blur-md border border-purple-500/30 text-purple-300 text-sm font-semibold transition-colors duration-300">
                                        <Sparkles className="w-4 h-4" />
                                        Now Live
                                    </span>
                                </div>

                                {/* City Name Overlay - Always white text over dark image */}
                                <div className="absolute bottom-6 left-6 right-6">
                                    <div className="flex items-center gap-3 mb-3">
                                        <MapPin className="w-6 h-6 text-white" />
                                        <h3 className="text-3xl md:text-5xl font-bold heading-font text-white">
                                            Bengaluru
                                        </h3>
                                    </div>
                                    <p className="text-sm md:text-base text-white/80">
                                        Silicon Valley of India • Tech Hub • Garden City
                                    </p>
                                </div>
                            </div>

                            {/* Info Section */}
                            <div className="p-6 md:p-8">
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-6">
                                    <div className="text-center p-4 rounded-xl transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', borderWidth: '1px', borderStyle: 'solid' }}>
                                        <Building2 className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                                        <p className="text-2xl md:text-3xl font-bold mb-1 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>50+</p>
                                        <p className="text-xs md:text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Digital Screens</p>
                                    </div>
                                    <div className="text-center p-4 rounded-xl transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', borderWidth: '1px', borderStyle: 'solid' }}>
                                        <MapPin className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                                        <p className="text-2xl md:text-3xl font-bold mb-1 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>25+</p>
                                        <p className="text-xs md:text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Prime Locations</p>
                                    </div>
                                    <div className="col-span-2 md:col-span-1 text-center p-4 rounded-xl transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', borderWidth: '1px', borderStyle: 'solid' }}>
                                        <Sparkles className="w-6 h-6 text-green-400 mx-auto mb-2" />
                                        <p className="text-2xl md:text-3xl font-bold mb-1 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>24/7</p>
                                        <p className="text-xs md:text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Live Campaigns</p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 md:p-6 rounded-xl bg-purple-500/10 border border-purple-500/20 transition-colors duration-300">
                                    <div className="flex-1">
                                        <p className="font-semibold mb-1 text-base md:text-lg transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Explore screens in Bengaluru</p>
                                        <p className="text-sm md:text-base transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Start your campaign today</p>
                                    </div>
                                    <ArrowRight className="w-6 h-6 md:w-8 md:h-8 group-hover:translate-x-2 transition-all duration-300 shrink-0" style={{ color: 'var(--text-primary)' }} />
                                </div>
                            </div>
                        </motion.div>
                    </Link>
                </motion.div>

                {/* Coming Soon Message */}
                <motion.div
                    variants={itemVariants}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    className="mt-12 text-center"
                >
                    <p className="text-sm md:text-base transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                        More cities coming soon • Stay tuned for Mumbai, Delhi, Hyderabad & Chennai
                    </p>
                </motion.div>
            </div>
        </section>
    );
};

export default BrowseByCities;
