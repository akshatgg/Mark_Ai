"use client";
import React from 'react';
import { motion } from 'framer-motion';
import { Target, Search, Calendar, Shield, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { containerVariants, itemVariants, headlineVariants } from '@/utility/animations';

const HomeHowItWorks = () => {
    const steps = [
        {
            number: 1,
            icon: Target,
            title: "Set Goals & Upload",
            description: "Set goals, audience, budget, and upload draft creatives (image/video).",
        },
        {
            number: 2,
            icon: Search,
            title: "Discover & Shortlist",
            description: "Discover and shortlist digital billboards by city, reach, CPM, and live availability.",
        },
        {
            number: 3,
            icon: Calendar,
            title: "Select & Submit",
            description: "Select dates/hours and frequency; see dynamic pricing; submit for owner approval.",
        },
        {
            number: 4,
            icon: Shield,
            title: "Fund & Confirm",
            description: "Fund via secure escrow; creatives pass QA; schedule is confirmed.",
        },
        {
            number: 5,
            icon: Play,
            title: "Go Live & Track",
            description: "Go live via CMS; track real‑time proof‑of‑play; export logs and optimize.",
        },
    ];

    return (
        <section className="relative w-full py-20 md:py-28 overflow-hidden transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)' }}>
            {/* Subtle background pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[50px_50px] opacity-50" />

            <div className="relative z-10 w-[85%] mx-auto">
                {/* Header */}
                <motion.div
                    className="text-center space-y-6 mb-16 md:mb-20"
                    variants={containerVariants}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-100px" }}
                >
                    <motion.h2
                        className="text-4xl md:text-5xl lg:text-6xl font-bold heading-font transition-colors duration-300"
                        style={{ color: 'var(--text-primary)' }}
                        variants={headlineVariants}
                    >
                        From Idea to Live Screens
                    </motion.h2>
                    <motion.p
                        className="text-lg md:text-xl max-w-3xl mx-auto transition-colors duration-300"
                        style={{ color: 'var(--text-secondary)' }}
                        variants={itemVariants}
                    >
                        A simple, streamlined process to get your DOOH campaigns live in minutes
                    </motion.p>
                </motion.div>

                {/* Steps Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                    {steps.map((step) => {
                        const Icon = step.icon;
                        return (
                            <motion.div
                                key={step.number}
                                variants={itemVariants}
                                initial="hidden"
                                whileInView="visible"
                                viewport={{ once: true, margin: "-50px" }}
                                whileHover={{ scale: 1.02, y: -5 }}
                                transition={{ type: "spring", stiffness: 300 }}
                                className={cn(
                                    "p-6 md:p-8 rounded-2xl backdrop-blur-md",
                                    "transition-all duration-300",
                                    "relative overflow-hidden"
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
                                {/* Gradient overlay on hover */}
                                <div className="absolute inset-0 bg-linear-to-br from-purple-500/0 to-purple-500/0 hover:from-purple-500/5 hover:to-purple-500/10 transition-all duration-300 pointer-events-none" />

                                <div className="relative z-10">
                                    {/* Step Number Badge */}
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className="w-12 h-12 rounded-lg bg-purple-500/20 border border-purple-400/30 flex items-center justify-center shrink-0">
                                            <Icon className="w-6 h-6 text-purple-400" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold text-purple-400">
                                                STEP {step.number}
                                            </span>
                                        </div>
                                    </div>

                                    <h3 className="text-2xl md:text-3xl font-bold mb-3 heading-font transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                                        {step.title}
                                    </h3>
                                    <p className="leading-relaxed text-base md:text-lg transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                                        {step.description}
                                    </p>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

export default HomeHowItWorks;

