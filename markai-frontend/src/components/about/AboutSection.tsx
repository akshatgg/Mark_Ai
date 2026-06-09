"use client";
import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
    ShieldCheck, Zap, LineChart, Search, Upload, BarChart3,
    Clock, CheckCircle2, TrendingUp, MapPin, Users, Target,
    Phone, AlertCircle, Sparkles, ArrowRight
} from 'lucide-react';

const founders = [
    {
        name: "Danish Ashraf",
        role: "CEO & Co-founder",
        title: "10+ yrs digital advertising. Previously scaled DOOH networks.",
        image: "/about/danish.jpeg"
    },
    {
        name: "Poornima Murugiah",
        role: "COO & Co-founder",
        title: "Operations expert. Managed 200+ screen networks.",
        image: "/about/poornima-p.jpeg"
    }
];

const steps = [
    {
        number: "1",
        title: "Search screens",
        description: "by city, audience, price",
        icon: Search
    },
    {
        number: "2",
        title: "Book hourly slots",
        description: "(no minimums)",
        icon: Clock
    },
    {
        number: "3",
        title: "Upload creative",
        description: "(we QA it)",
        icon: Upload
    },
    {
        number: "4",
        title: "Track views",
        description: "+ proof-of-play in dashboard",
        icon: BarChart3
    }
];

const benefits = [
    {
        title: "No contracts, no minimums",
        description: "Book 1 hour or 1 year. Pay only for confirmed plays.",
        icon: CheckCircle2
    },
    {
        title: "Real proof-of-play",
        description: "Escrow releases only after screen operator confirms delivery.",
        icon: ShieldCheck
    },
    {
        title: "Audience-matched screens",
        description: "30+ verified CCD venues. Each shows TG, views, and best categories.",
        icon: Target
    },
    {
        title: "RazorPay escrow",
        description: "UPI, cards, wallets. Funds safe until your ad plays.",
        icon: Zap
    }
];

const stats = [
    { value: "30", label: "Screens live in Bengaluru", icon: MapPin },
    { value: "15,000+", label: "Weekly views per screen", icon: Users },
    { value: "100%", label: "Proof-of-play verification", icon: CheckCircle2 },
    { value: "25+", label: "Categories covered", icon: TrendingUp }
];

const comparisonData = [
    { feature: "Booking", traditional: "Phone/email", markai: "Browser, 2 mins" },
    { feature: "Minimum spend", traditional: "₹50,000+", markai: "None" },
    { feature: "Proof-of-play", traditional: "Manual logs", markai: "Automatic CMS" },
    { feature: "Payment", traditional: "Invoice 30 days", markai: "Escrow, pay-per-play" },
    { feature: "Audience data", traditional: "None", markai: "Per screen TG" }
];

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.15 }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.5 }
    }
};

const AboutSection = () => {
    return (
        <div
            className="relative w-full min-h-screen py-20 md:py-32 transition-colors duration-300"
            style={{ backgroundColor: 'var(--bg-primary)' }}
        >
            {/* Grid pattern background */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[50px_50px]" />
            {/* Theme-aware gradient backgrounds */}
            <div className="dark:block hidden absolute inset-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(123,67,255,0.25),transparent_55%)]" />
                <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(139,92,246,0.1),transparent)]" />
            </div>

            <div className="relative z-10 w-[85%] mx-auto space-y-32">
                {/* Hero Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="text-center space-y-8"
                >
                    <div className="space-y-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5 }}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-lg transition-colors duration-300 border"
                            style={{
                                borderColor: 'var(--border-primary)',
                                backgroundColor: 'var(--bg-card)'
                            }}
                        >
                            <Sparkles className="w-4 h-4" style={{ color: 'var(--text-accent)' }} />
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-accent)' }}>
                                India's First Browser-Native DOOH Marketplace
                            </span>
                        </motion.div>

                        <h1
                            className="text-4xl md:text-5xl lg:text-7xl font-bold heading-font leading-tight transition-colors duration-300"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            Buy digital billboards like you{' '}
                            <span style={{ color: 'var(--text-accent)' }}>book online ads</span>
                        </h1>

                        <p
                            className="text-lg md:text-xl max-w-3xl mx-auto transition-colors duration-300"
                            style={{ color: 'var(--text-secondary)' }}
                        >
                            No sales calls. No retainers. Just screens, budget, and results.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
                        <Link
                            href="/browse-screens"
                            className="px-8 py-4 rounded-lg font-semibold text-white transition-all duration-300 hover:shadow-lg flex items-center gap-2"
                            style={{ backgroundColor: 'var(--accent-purple)' }}
                        >
                            Browse screens
                            <ArrowRight className="w-5 h-5" />
                        </Link>
                        <Link
                            href="/contact"
                            className="px-8 py-4 rounded-lg font-semibold transition-all duration-300 hover:shadow-lg"
                            style={{
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-primary)',
                                backgroundColor: 'var(--bg-card)'
                            }}
                        >
                            Book demo
                        </Link>
                    </div>
                </motion.div>

                {/* The Problem Section */}
                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6 }}
                    className="space-y-12"
                >
                    <h2
                        className="text-3xl md:text-4xl lg:text-5xl font-bold heading-font text-center transition-colors duration-300"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        DOOH bookings are{' '}
                        <span style={{ color: 'var(--text-accent)' }}>stuck in 2010.</span>
                    </h2>

                    <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                        {/* Problem side */}
                        <motion.div
                            whileHover={{ y: -5 }}
                            className="p-8 rounded-2xl space-y-4 transition-all duration-300"
                            style={{
                                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.1) 100%)',
                                border: '1px solid rgba(239, 68, 68, 0.2)'
                            }}
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <AlertCircle className="w-8 h-8 text-red-500" />
                                <h3 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                                    The Old Way
                                </h3>
                            </div>
                            <ul className="space-y-3">
                                {[
                                    "Cold calls to agencies",
                                    "Endless negotiations",
                                    "15-day contracts",
                                    "No transparency on actual playtime",
                                    "No proof of delivery",
                                    "40% budget wasted on 'sold' screens that never play"
                                ].map((item, i) => (
                                    <li key={i} className="flex items-start gap-3" style={{ color: 'var(--text-secondary)' }}>
                                        <Phone className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </motion.div>

                        {/* Solution side */}
                        <motion.div
                            whileHover={{ y: -5 }}
                            className="p-8 rounded-2xl space-y-4 transition-all duration-300"
                            style={{
                                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.1) 100%)',
                                border: '1px solid rgba(16, 185, 129, 0.2)'
                            }}
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <Sparkles className="w-8 h-8 text-green-500" />
                                <h3 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                                    The MarkAI Way
                                </h3>
                            </div>
                            <p className="text-lg font-semibold" style={{ color: 'var(--text-accent)' }}>
                                Brands need a better way.
                            </p>
                            <p style={{ color: 'var(--text-secondary)' }}>
                                We built India's first browser-native DOOH marketplace where you can book digital billboards
                                as easily as running a Facebook ad—with full transparency, proof-of-play, and no minimum spend.
                            </p>
                        </motion.div>
                    </div>
                </motion.div>

                {/* How MarkAI Works Section */}
                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    className="space-y-12"
                >
                    <div className="text-center space-y-4">
                        <h2
                            className="text-3xl md:text-4xl lg:text-5xl font-bold heading-font transition-colors duration-300"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            4 clicks to{' '}
                            <span style={{ color: 'var(--text-accent)' }}>live campaign</span>
                        </h2>
                    </div>

                    <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
                    >
                        {steps.map((step, index) => {
                            const IconComponent = step.icon;
                            return (
                                <motion.div
                                    key={index}
                                    variants={itemVariants}
                                    whileHover={{ y: -8, scale: 1.03 }}
                                    className="relative p-6 rounded-2xl transition-all duration-300"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%)',
                                        border: '1px solid var(--border-primary)'
                                    }}
                                >
                                    <div className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center font-bold text-xl"
                                        style={{
                                            backgroundColor: 'var(--accent-purple)',
                                            color: '#ffffff'
                                        }}
                                    >
                                        {step.number}
                                    </div>

                                    <IconComponent className="w-12 h-12 mb-4" style={{ color: 'var(--text-accent)' }} />

                                    <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                        {step.title}
                                    </h3>
                                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                        {step.description}
                                    </p>
                                </motion.div>
                            );
                        })}
                    </motion.div>
                </motion.div>

                {/* Why Brands Choose MarkAI Section */}
                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    className="space-y-12"
                >
                    <h2
                        className="text-3xl md:text-4xl lg:text-5xl font-bold heading-font text-center transition-colors duration-300"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        Why brands choose{' '}
                        <span style={{ color: 'var(--text-accent)' }}>MarkAI</span>
                    </h2>

                    <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
                    >
                        {benefits.map((benefit, index) => {
                            const IconComponent = benefit.icon;
                            const gradients = [
                                'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%)',
                                'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.1) 100%)',
                                'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(217, 119, 6, 0.1) 100%)',
                                'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.1) 100%)'
                            ];

                            return (
                                <motion.div
                                    key={index}
                                    variants={itemVariants}
                                    whileHover={{ y: -8, scale: 1.02 }}
                                    className="p-6 rounded-2xl transition-all duration-300"
                                    style={{
                                        background: gradients[index],
                                        border: '1px solid var(--border-primary)',
                                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
                                    }}
                                >
                                    <IconComponent className="w-12 h-12 mb-4" style={{ color: 'var(--text-accent)' }} />

                                    <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
                                        {benefit.title}
                                    </h3>
                                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                        {benefit.description}
                                    </p>
                                </motion.div>
                            );
                        })}
                    </motion.div>
                </motion.div>

                {/* Traction Section */}
                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    className="space-y-12"
                >
                    <div className="text-center space-y-4">
                        <h2
                            className="text-3xl md:text-4xl lg:text-5xl font-bold heading-font transition-colors duration-300"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <span style={{ color: 'var(--text-accent)' }}>30 screens</span> live in Bengaluru
                        </h2>
                    </div>

                    <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
                    >
                        {stats.map((stat, index) => {
                            const IconComponent = stat.icon;
                            return (
                                <motion.div
                                    key={index}
                                    variants={itemVariants}
                                    whileHover={{ scale: 1.05 }}
                                    className="p-6 rounded-2xl text-center transition-all duration-300"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.1) 100%)',
                                        border: '1px solid var(--border-primary)'
                                    }}
                                >
                                    <IconComponent className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--text-accent)' }} />
                                    <div className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-accent)' }}>
                                        {stat.value}
                                    </div>
                                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                        {stat.label}
                                    </p>
                                </motion.div>
                            );
                        })}
                    </motion.div>

                    <p className="text-center text-lg" style={{ color: 'var(--text-secondary)' }}>
                        Expanding to <span style={{ color: 'var(--text-accent)' }}>Hyderabad, Chennai</span> Q2 2026
                    </p>
                </motion.div>

                {/* Team Section */}
                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    className="space-y-12"
                >
                    <div className="text-center space-y-4">
                        <h2
                            className="text-3xl md:text-4xl lg:text-5xl font-bold heading-font transition-colors duration-300"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            Built by{' '}
                            <span style={{ color: 'var(--text-accent)' }}>adtech operators</span>
                        </h2>
                    </div>

                    <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        className="grid grid-cols-1 md:grid-cols-2 gap-12 max-w-4xl mx-auto"
                    >
                        {founders.map((founder, index) => (
                            <motion.div
                                key={founder.name}
                                variants={itemVariants}
                                whileHover={{ y: -8 }}
                                className="flex flex-col items-center text-center"
                            >
                                <motion.div
                                    whileHover={{ scale: 1.05 }}
                                    className="relative w-40 h-40 md:w-48 md:h-48 mb-6 rounded-full overflow-hidden shadow-xl"
                                    style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.1)' }}
                                >
                                    <Image
                                        src={founder.image}
                                        alt={founder.name}
                                        fill
                                        className="object-cover"
                                        priority={index === 0}
                                    />
                                </motion.div>

                                <h3 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                    {founder.name}
                                </h3>
                                <p className="text-lg font-semibold mb-3" style={{ color: 'var(--text-accent)' }}>
                                    {founder.role}
                                </p>
                                <p className="text-base max-w-sm" style={{ color: 'var(--text-secondary)' }}>
                                    {founder.title}
                                </p>
                            </motion.div>
                        ))}
                    </motion.div>
                </motion.div>

                {/* Comparison Table Section */}
                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    className="space-y-12"
                >
                    <h2
                        className="text-3xl md:text-4xl lg:text-5xl font-bold heading-font text-center transition-colors duration-300"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        How we're{' '}
                        <span style={{ color: 'var(--text-accent)' }}>different</span>
                    </h2>

                    <div className="max-w-4xl mx-auto overflow-x-auto">
                        <div className="min-w-[600px]">
                            {/* Table Header */}
                            <div className="grid grid-cols-3 gap-4 mb-4">
                                <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-card)' }}>
                                    <h3 className="font-bold text-center" style={{ color: 'var(--text-primary)' }}>
                                        Feature
                                    </h3>
                                </div>
                                <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-card)' }}>
                                    <h3 className="font-bold text-center" style={{ color: 'var(--text-secondary)' }}>
                                        Traditional Agencies
                                    </h3>
                                </div>
                                <div className="p-4 rounded-lg" style={{
                                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(124, 58, 237, 0.2) 100%)',
                                    border: '2px solid var(--accent-purple)'
                                }}>
                                    <h3 className="font-bold text-center" style={{ color: 'var(--text-accent)' }}>
                                        Mark AI 
                                    </h3>
                                </div>
                            </div>

                            {/* Table Rows */}
                            {comparisonData.map((row, index) => (
                                <motion.div
                                    key={index}
                                    initial={{ opacity: 0, x: -20 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: index * 0.1 }}
                                    className="grid grid-cols-3 gap-4 mb-3"
                                >
                                    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-card)' }}>
                                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                                            {row.feature}
                                        </p>
                                    </div>
                                    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-card)' }}>
                                        <p style={{ color: 'var(--text-secondary)' }}>{row.traditional}</p>
                                    </div>
                                    <div className="p-4 rounded-lg" style={{
                                        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.1) 100%)',
                                        border: '1px solid rgba(16, 185, 129, 0.3)'
                                    }}>
                                        <p className="font-semibold" style={{ color: 'var(--text-accent)' }}>
                                            {row.markai}
                                        </p>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </motion.div>

                {/* Final CTA Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center space-y-8 py-16 px-6 rounded-3xl"
                    style={{
                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.1) 100%)',
                        border: '1px solid var(--border-primary)'
                    }}
                >
                    <h2
                        className="text-3xl md:text-4xl lg:text-5xl font-bold heading-font transition-colors duration-300"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        Ready to try DOOH{' '}
                        <span style={{ color: 'var(--text-accent)' }}>without the headache?</span>
                    </h2>

                    <p
                        className="text-lg md:text-xl max-w-2xl mx-auto transition-colors duration-300"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        India's first pay-per-play DOOH marketplace. Book your first screen today.
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
                        <Link
                            href="/dashboard"
                            className="px-8 py-4 rounded-lg font-semibold text-white transition-all duration-300 hover:shadow-xl flex items-center gap-2"
                            style={{ backgroundColor: 'var(--accent-purple)' }}
                        >
                            Browse 30+ screens
                            <ArrowRight className="w-5 h-5" />
                        </Link>
                        <Link
                            href="/contact"
                            className="px-8 py-4 rounded-lg font-semibold transition-all duration-300 hover:shadow-lg"
                            style={{
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-primary)',
                                backgroundColor: 'var(--bg-card)'
                            }}
                        >
                            Book 15-min demo
                        </Link>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

export default AboutSection;
