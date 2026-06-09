"use client";
import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { containerVariants, itemVariants, headlineVariants } from '@/utility/animations';

const HomeHowItWorks = () => {
    const steps = [
        {
            number: 1,
            title: "Set Goals & Upload",
            description: "Set goals, audience, budget, and upload draft creatives (image/video).",
        },
        {
            number: 2,
            title: "Discover & Shortlist",
            description: "Discover and shortlist digital billboards by city, reach, CPM, and live availability.",
        },
        {
            number: 3,
            title: "Select & Submit",
            description: "Select dates/hours and frequency; see dynamic pricing; submit for owner approval.",
        },
        {
            number: 4,
            title: "Fund & Confirm",
            description: "Fund via secure escrow; creatives pass QA; schedule is confirmed.",
        },
        {
            number: 5,
            title: "Go Live & Track",
            description: "Go live via CMS; track real‑time proof‑of‑play; export logs and optimize.",
        },
    ];

    return (
        <section className="relative w-full py-20 md:py-28 overflow-hidden transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)' }}>
            {/* Subtle background pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[50px_50px] opacity-50" />

            <div className="relative z-10 w-[88%] md:w-[85%] mx-auto">
                {/* Header */}
                <motion.div
                    className="text-center mb-16 md:mb-24"
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
                        How <span className="brand-gradient-text">Mark&nbsp;AI</span> works.
                    </motion.h2>
                </motion.div>

                {/* Timeline */}
                <div className="relative mx-auto max-w-4xl">
                    {/* Connecting bar (left on mobile, centered on desktop) — thin & subtle */}
                    <div
                        className="absolute top-3 bottom-3 w-px rounded-full left-6 md:left-1/2 md:-translate-x-1/2"
                        style={{ backgroundColor: 'var(--border-primary)' }}
                    />

                    <div className="flex flex-col">
                        {steps.map((step, index) => {
                            const onLeft = index % 2 === 0;
                            return (
                                <div
                                    key={step.number}
                                    className="relative flex md:grid md:grid-cols-2 md:items-center py-5 md:py-7"
                                >
                                    {/* Dot node on the bar */}
                                    <div className="absolute z-20 left-6 top-1/2 -translate-x-1/2 -translate-y-1/2 md:left-1/2">
                                        <div
                                            className="brand-gradient-bg-cool h-4 w-4 rounded-full ring-4"
                                            style={{ ['--tw-ring-color' as any]: 'var(--bg-primary)' }}
                                        />
                                    </div>

                                    {/* Card */}
                                    <motion.div
                                        initial={{ opacity: 0, x: onLeft ? -48 : 48, y: 16 }}
                                        whileInView={{ opacity: 1, x: 0, y: 0 }}
                                        viewport={{ once: true, margin: "-80px" }}
                                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                                        whileHover={{ y: -6 }}
                                        className={cn(
                                            "group relative w-full md:w-auto overflow-hidden rounded-2xl py-6 pl-8 pr-6 md:py-7 md:pl-9 md:pr-7 shadow-lg transition-shadow duration-300 hover:shadow-xl",
                                            "ml-16",
                                            onLeft
                                                ? "md:ml-0 md:mr-10 md:col-start-1 md:row-start-1"
                                                : "md:ml-10 md:col-start-2 md:row-start-1"
                                        )}
                                        style={{
                                            backgroundColor: 'var(--bg-card)',
                                            borderColor: 'var(--border-primary)',
                                            borderWidth: '1px',
                                            borderStyle: 'solid',
                                        }}
                                    >
                                        {/* Left accent strip */}
                                        <span className="brand-gradient-bg-cool absolute left-0 top-8 bottom-8 w-1.5 rounded-r-full" />

                                        <h3 className="mb-2 text-xl md:text-2xl font-bold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                                            {step.title}
                                        </h3>
                                        <p className="leading-relaxed text-sm md:text-base transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                                            {step.description}
                                        </p>
                                    </motion.div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default HomeHowItWorks;
