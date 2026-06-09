"use client";
import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { containerVariants, itemVariants, headlineVariants, statusDotVariants } from '@/utility/animations';

const HeroSection = () => {
    const [currentImageIndex, setCurrentImageIndex] = React.useState(0);

    // List of background images
    const backgroundImages = [
        '/backgroundnew.jpeg',
        '/bg3.png',
    ];

    // Auto-advance slider every 5 seconds
    React.useEffect(() => {
        const interval = setInterval(() => {
            setCurrentImageIndex((prevIndex) => (prevIndex + 1) % backgroundImages.length);
        }, 5000);

        return () => clearInterval(interval);
    }, [backgroundImages.length]);

    return (
        <div className="relative w-full h-screen overflow-hidden">
            {/* Full-screen background image slider */}
            {backgroundImages.map((imageSrc, index) => (
                <motion.div
                    key={imageSrc}
                    className="absolute inset-0 w-full h-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: currentImageIndex === index ? 1 : 0 }}
                    transition={{ duration: 1 }}
                >
                    <Image
                        src={imageSrc}
                        alt={`Background ${index + 1}`}
                        fill
                        className="object-cover"
                        priority={index === 0}
                        quality={90}
                    />
                </motion.div>
            ))}

            {/* Gradient overlay - dark mode */}
            <motion.div
                className="dark:block hidden absolute inset-0 z-10 backdrop-blur-sm"
                style={{
                    maskImage: 'linear-gradient(to right, black, black 40%, transparent 80%)',
                    WebkitMaskImage: 'linear-gradient(to right, black, black 40%, transparent 80%)'
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8 }}
            />
            {/* Light mode blur layer - from left to right */}
            <motion.div
                className="dark:hidden block absolute inset-0 z-10 backdrop-blur-md"
                style={{
                    maskImage: 'linear-gradient(to right, black, black 40%, transparent 80%)',
                    WebkitMaskImage: 'linear-gradient(to right, black, black 40%, transparent 80%)'
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8 }}
            />

            {/* Content container */}
            <div className="relative w-[85%] mx-auto z-20 h-full flex items-center">
                <div className="mx-auto w-full">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
                        {/* Left Section - Content */}
                        <motion.div
                            className="space-y-5 transition-colors duration-300"
                            // style={{ color: 'var(--text-primary)' }}
                            variants={containerVariants}
                            initial="hidden"
                            animate="visible"
                        >
                            {/* Status Indicator */}
                            <motion.div
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-lg transition-colors duration-300 border border-white/30"
                                variants={itemVariants}
                                whileHover={{ scale: 1.05 }}
                                transition={{ type: "spring", stiffness: 300 }}
                            >
                                <motion.div
                                    className="w-2 h-2 rounded-full bg-green-500"
                                    variants={statusDotVariants}
                                    animate="animate"
                                />
                                <span className="text-sm font-semibold text-white">Self-service. No contracts. No commitments.</span>
                            </motion.div>

                            {/* Headline */}
                            <motion.h1
                                className="text-4xl md:text-5xl lg:text-6xl font-semibold leading-tight heading-font transition-colors duration-300 text-white"
                                style={{
                                    // transformStyle: "preserve-3d",
                                    textShadow: "0 10px 30px rgba(0, 0, 0, 0.3), 0 0 20px rgba(168, 85, 247, 0.1), 0 5px 15px rgba(0, 0, 0, 0.4)",
                                    // letterSpacing: "0.02em",
                                }}
                                variants={headlineVariants}
                            >
                                Buy outdoor ads <span className="brand-gradient-text">in minutes</span>, from one browser.
                            </motion.h1>

                            {/* Description */}
                            <motion.div
                                className="text-lg font-medium md:text-xl leading-relaxed max-w-2xl transition-colors duration-300 text-white"
                                variants={itemVariants}
                            >
                                {/* <p className='mb-2'>
                                    Find digital billboards, set your budget, upload your creative, and launch.
                                </p> */}
                                <p className='font-semibold w-fit mb-2 text-lg md:text-xl text-white/90'>No long contracts. No minimum spend.
                                </p>

                                {/* <p>
                                    For brands and agencies in India. Plan, book, and track DOOH campaigns on one simple dashboard.
                                </p> */}
                            </motion.div>


                            {/* Action Buttons */}
                            <motion.div
                                className="flex flex-wrap items-center gap-4 pt-4"
                                variants={itemVariants}
                            >
                                <motion.div
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                                >
                                    <Link
                                        href="/auth/login"
                                        className={cn(
                                            "brand-gradient-bg px-10 py-3 rounded-full font-semibold text-lg",
                                            "transition-all duration-200",
                                            "shadow-lg hover:shadow-xl",
                                            "block text-center"
                                        )}
                                    >
                                        Advertise
                                    </Link>
                                </motion.div>

                                <motion.div
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                                >
                                    <Link
                                        href="/browse-screens"
                                        className={cn(
                                            "px-10 py-3 rounded-full font-semibold text-lg text-white",
                                            "bg-white/10 backdrop-blur-md border border-white/40",
                                            "transition-all duration-200 hover:bg-white/20",
                                            "block text-center"
                                        )}
                                    >
                                        Explore Screens
                                    </Link>
                                </motion.div>

                            </motion.div>
                        </motion.div>


                    </div>
                </div>
            </div>

            {/* Subtle star/dust effect overlay */}
            <motion.div
                className="absolute inset-0 z-10 pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.5, delay: 0.8 }}
            >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-size-[50px_50px] opacity-30" />
            </motion.div>
        </div>
    );
};

export default HeroSection;