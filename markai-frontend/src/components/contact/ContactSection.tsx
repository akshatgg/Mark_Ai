"use client";
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion } from 'framer-motion';
import { ArrowRight, Search, Clock, BarChart3, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { containerVariants, itemVariants, headlineVariants } from '@/utility/animations';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import toast from 'react-hot-toast';

// Form validation schema
const contactFormSchema = z.object({
    fullName: z.string().min(2, "Full name must be at least 2 characters"),
    email: z.string().email("Please enter a valid email address"),
    topic: z.string().min(3, "Topic must be at least 3 characters"),
    message: z.string().min(10, "Message must be at least 10 characters"),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

const ContactSection = () => {
    const [isSuccess, setIsSuccess] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
        reset,
    } = useForm<ContactFormData>({
        resolver: zodResolver(contactFormSchema),
    });

    const onSubmit = async (data: ContactFormData) => {
        try {
            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to send message');
            }

            // Show success state
            setIsSuccess(true);
            toast.success(result.message || 'Message sent successfully!');
            reset();

            // Hide success state after 5 seconds
            setTimeout(() => {
                setIsSuccess(false);
            }, 5000);

        } catch (error: any) {
            console.error('Contact form error:', error);
            toast.error(error.message || 'Failed to send message. Please try again.');
        }
    };

    const infoCards = [
        {
            icon: Search,
            title: "Real-time inventory search",
            description: "Discover available DOOH screens instantly with our advanced search and filter system. Find screens by location, price, size, and live availability.",
        },
        {
            icon: Clock,
            title: "Hourly booking system",
            description: "Book screen time by the hour with conflict-free scheduling. Set frequency, control pacing, and manage your campaigns in real-time.",
        },
        {
            icon: BarChart3,
            title: "Analytics & proof-of-play",
            description: "Track campaign performance with comprehensive analytics, reach models, pacing indicators, and exportable proof-of-play logs.",
        },
    ];

    const faqs = [
        {
            question: "How do I find and book screens?",
            answer: "Search by city, neighbourhood, screen type, or price. Filter by availability, see estimated views and TG, then book hourly slots. Upload your creative and pay securely via RazorPay escrow.",
        },
        {
            question: "What is proof-of-play?",
            answer: "Automatic confirmation that your ad actually played on the screen. We get this directly from screen operators' CMS. Your payment is released from escrow only after verified delivery.",
        },
        {
            question: "How much does it cost?",
            answer: "From ₹25/hour. Exact price shown before booking. No minimum spend, no contracts. Pay only for confirmed playtime. GST included in displayed price.",
        },
        {
            question: "What payment methods work?",
            answer: "RazorPay – UPI, cards, net banking, wallets. Funds held in escrow, released only after proof-of-play. No chargebacks needed.",
        },
        {
            question: "Can I see campaign results?",
            answer: "Yes. Dashboard shows daily views, screen locations, play confirmations, and spend pacing. Download proof-of-play reports anytime.",
        },
        {
            question: "What if my ad doesn't play?",
            answer: "No play = no charge. If proof-of-play isn't received, funds stay in escrow. You get credited or refunded automatically.",
        },
        {
            question: "How do I upload my creative?",
            answer: "Upload JPG/PNG/MP4 directly. Max 10MB. We check format, resolution, and compliance before approving. Get feedback if needed.",
        },
        {
            question: "What screens are available?",
            answer: "30+ CCD screens across Bengaluru – cafés, salons, gyms, clinics. Each shows location, audience, views, and best categories.",
        },
    ];

    return (
        <div className="relative w-full min-h-screen transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)' }}>

            {/* Theme-aware gradient backgrounds - only visible in dark mode */}
            <div className="dark:block hidden absolute inset-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(123,67,255,0.25),transparent_55%)]" />
                <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(139,92,246,0.1),transparent)]" />
            </div>
            {/* Grid pattern background */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[50px_50px]" />

            <section className="relative z-10 pt-32 pb-20 md:pt-40 md:pb-28">
                <div className="w-[85%] mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
                        {/* Left Section - Contact Form */}
                        <motion.div
                            className="space-y-8"
                            variants={containerVariants}
                            initial="hidden"
                            whileInView="visible"
                            viewport={{ once: true, margin: "-100px" }}
                        >
                            <motion.div variants={headlineVariants}>
                                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold heading-font mb-4 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                                    Let's talk with us!
                                </h1>
                                <p className="text-lg transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                                    Have questions about our DOOH marketplace? Need help with bookings, campaigns, or integrations? We're here to help.
                                </p>
                            </motion.div>

                            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                                {/* Full Name */}
                                <motion.div variants={itemVariants}>
                                    <label htmlFor="fullName" className="block text-sm font-medium mb-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                                        Full name
                                    </label>
                                    <input
                                        id="fullName"
                                        type="text"
                                        {...register("fullName")}
                                        className={cn(
                                            "w-full px-4 py-3 rounded-lg",
                                            "backdrop-blur-md placeholder-gray-500",
                                            "focus:outline-none",
                                            "transition-colors duration-300",
                                            errors.fullName && "border-red-500/50"
                                        )}
                                        style={{
                                            backgroundColor: 'var(--bg-card)',
                                            borderWidth: '1px',
                                            borderStyle: 'solid',
                                            borderColor: 'var(--border-primary)',
                                            color: 'var(--text-primary)'
                                        }}
                                        placeholder="Enter your full name"
                                    />
                                    {errors.fullName && (
                                        <p className="mt-1 text-sm text-red-400">{errors.fullName.message}</p>
                                    )}
                                </motion.div>

                                {/* Email */}
                                <motion.div variants={itemVariants}>
                                    <label htmlFor="email" className="block text-sm font-medium mb-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                                        Email
                                    </label>
                                    <input
                                        id="email"
                                        type="email"
                                        {...register("email")}
                                        className={cn(
                                            "w-full px-4 py-3 rounded-lg",
                                            "backdrop-blur-md placeholder-gray-500",
                                            "focus:outline-none",
                                            "transition-colors duration-300",
                                            errors.email && "border-red-500/50"
                                        )}
                                        style={{
                                            backgroundColor: 'var(--bg-card)',
                                            borderWidth: '1px',
                                            borderStyle: 'solid',
                                            borderColor: 'var(--border-primary)',
                                            color: 'var(--text-primary)'
                                        }}
                                        placeholder="Enter your email"
                                    />
                                    {errors.email && (
                                        <p className="mt-1 text-sm text-red-400">{errors.email.message}</p>
                                    )}
                                </motion.div>

                                {/* Topic */}
                                <motion.div variants={itemVariants}>
                                    <label htmlFor="topic" className="block text-sm font-medium mb-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                                        Topic
                                    </label>
                                    <input
                                        id="topic"
                                        type="text"
                                        {...register("topic")}
                                        className={cn(
                                            "w-full px-4 py-3 rounded-lg",
                                            "backdrop-blur-md placeholder-gray-500",
                                            "focus:outline-none",
                                            "transition-colors duration-300",
                                            errors.topic && "border-red-500/50"
                                        )}
                                        style={{
                                            backgroundColor: 'var(--bg-card)',
                                            borderWidth: '1px',
                                            borderStyle: 'solid',
                                            borderColor: 'var(--border-primary)',
                                            color: 'var(--text-primary)'
                                        }}
                                        placeholder="Type your topic"
                                    />
                                    {errors.topic && (
                                        <p className="mt-1 text-sm text-red-400">{errors.topic.message}</p>
                                    )}
                                </motion.div>

                                {/* Message */}
                                <motion.div variants={itemVariants}>
                                    <label htmlFor="message" className="block text-sm font-medium mb-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                                        How can we help you?
                                    </label>
                                    <textarea
                                        id="message"
                                        rows={6}
                                        {...register("message")}
                                        className={cn(
                                            "w-full px-4 py-3 rounded-lg resize-none",
                                            "backdrop-blur-md placeholder-gray-500",
                                            "focus:outline-none",
                                            "transition-colors duration-300",
                                            errors.message && "border-red-500/50"
                                        )}
                                        style={{
                                            backgroundColor: 'var(--bg-card)',
                                            borderWidth: '1px',
                                            borderStyle: 'solid',
                                            borderColor: 'var(--border-primary)',
                                            color: 'var(--text-primary)'
                                        }}
                                        placeholder="Space for your message"
                                    />
                                    {errors.message && (
                                        <p className="mt-1 text-sm text-red-400">{errors.message.message}</p>
                                    )}
                                </motion.div>

                                {/* Success Message */}
                                {isSuccess && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="p-4 rounded-lg flex items-center gap-3"
                                        style={{
                                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                            border: '1px solid rgba(16, 185, 129, 0.3)'
                                        }}
                                    >
                                        <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                                            Thank you! We've received your message and will get back to you soon.
                                        </p>
                                    </motion.div>
                                )}

                                {/* Submit Button */}
                                <motion.div variants={itemVariants}>
                                    <motion.button
                                        type="submit"
                                        disabled={isSubmitting}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        className={cn(
                                            "w-full px-8 py-4 rounded-lg font-semibold text-base",
                                            "bg-(--bg-primary) text-(--text-primary) border",
                                            "focus:outline-none focus:ring-2 focus:ring-white/50",
                                            "transition-all duration-200",
                                            "flex items-center justify-center gap-2",
                                            "shadow-lg hover:shadow-xl",
                                            isSubmitting && "opacity-50 cursor-not-allowed"
                                        )}
                                    >
                                        {isSubmitting ? (
                                            "Sending..."
                                        ) : (
                                            <>
                                                Send message
                                                <ArrowRight className="w-5 h-5" />
                                            </>
                                        )}
                                    </motion.button>
                                </motion.div>
                            </form>
                        </motion.div>

                        {/* Right Section - Information Cards */}
                        <motion.div
                            className="space-y-6 lg:sticky lg:top-32 lg:self-start"
                            variants={containerVariants}
                            initial="hidden"
                            whileInView="visible"
                            viewport={{ once: true, margin: "-100px" }}
                        >
                            {infoCards.map((card, index) => {
                                const Icon = card.icon;
                                return (
                                    <motion.div
                                        key={index}
                                        variants={itemVariants}
                                        whileHover={{ scale: 1.02, y: -5 }}
                                        transition={{ type: "spring", stiffness: 300 }}
                                        className={cn(
                                            "p-6 rounded-2xl",
                                            "backdrop-blur-md",
                                            "transition-colors duration-300"
                                        )}
                                        style={{
                                            backgroundColor: 'var(--bg-card)',
                                            borderWidth: '1px',
                                            borderStyle: 'solid',
                                            borderColor: 'var(--border-primary)'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--bg-accent)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                                        }}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                                                <Icon className="w-6 h-6 text-purple-400" />
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="text-xl font-bold mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                                                    {card.title}
                                                </h3>
                                                <p className="leading-relaxed transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                                                    {card.description}
                                                </p>
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* FAQs Section */}
            <section className="relative z-10 py-20">
                <div className="w-[85%] mx-auto">
                    <motion.div
                        className="text-center space-y-6 mb-16"
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
                            Frequently Asked Questions
                        </motion.h2>
                        <motion.p
                            className="text-lg md:text-xl max-w-3xl mx-auto transition-colors duration-300"
                            style={{ color: 'var(--text-secondary)' }}
                            variants={itemVariants}
                        >
                            Find answers to common questions about our DOOH marketplace, booking process, payments, and more.
                        </motion.p>
                    </motion.div>

                    <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true, margin: "-100px" }}
                    >
                        <div className="w-[80%] mx-auto">
                            <Accordion type="single" collapsible className="w-full">
                                {faqs.map((faq, index) => (
                                    <motion.div
                                        key={index}
                                        variants={itemVariants}
                                    >
                                        <AccordionItem
                                            value={`item-${index}`}
                                            className={cn(
                                                "rounded-2xl overflow-hidden cursor-pointer",
                                                "backdrop-blur-md transition-colors duration-300",
                                                "px-6 mb-4",
                                                "last:border-b-0"
                                            )}
                                            style={{
                                                backgroundColor: 'var(--bg-card)',
                                                borderWidth: '1px',
                                                borderStyle: 'solid',
                                                borderColor: 'var(--border-primary)'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = 'var(--bg-accent)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                                            }}
                                        >
                                            <AccordionTrigger className={cn(
                                                "text-left font-semibold text-lg cursor-pointer transition-colors duration-300",
                                                "py-6"
                                            )}
                                                style={{ color: 'var(--text-primary)' }}>
                                                {faq.question}
                                            </AccordionTrigger>
                                            <AccordionContent className={cn(
                                                "text-[1rem] leading-relaxed transition-colors duration-300",
                                                "pb-6"
                                            )}
                                                style={{ color: 'var(--text-secondary)' }}>
                                                {faq.answer}
                                            </AccordionContent>
                                        </AccordionItem>
                                    </motion.div>
                                ))}
                            </Accordion>
                        </div>
                    </motion.div>
                </div>
            </section>
        </div>
    );
};

export default ContactSection;

