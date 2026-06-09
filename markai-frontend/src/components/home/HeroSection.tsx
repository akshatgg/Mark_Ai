"use client";
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, MapPin } from "lucide-react";

const HeroSection = () => {
  return (
    <section className="relative w-full overflow-hidden bg-white dark:bg-[#0a0e1a] pt-28 pb-20 md:pt-32 md:pb-28">
      <div
        aria-hidden
        className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full blur-3xl opacity-30"
        style={{ background: "radial-gradient(circle, var(--brand-blue) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-40 -right-32 h-[520px] w-[520px] rounded-full blur-3xl opacity-25"
        style={{ background: "radial-gradient(circle, var(--brand-cyan) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="absolute top-1/3 right-1/4 h-[280px] w-[280px] rounded-full blur-3xl opacity-20"
        style={{ background: "radial-gradient(circle, var(--brand-lime) 0%, transparent 70%)" }}
      />

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 lg:grid-cols-2 lg:gap-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative"
        >
          <span
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-white/10 bg-white/70 dark:bg-white/5 px-4 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 backdrop-blur"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--brand-green)" }} />
            India&apos;s Premium DOOH Network
          </span>

          <h1 className="mt-6 text-4xl font-bold leading-[1.05] tracking-tight text-gray-900 dark:text-white md:text-6xl lg:text-[64px]">
            Transform your brand with{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 55%, var(--brand-green) 100%)",
              }}
            >
              creative DOOH
            </span>{" "}
            advertising.
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Mark AI puts your campaigns on 1,500+ premium digital screens across 56
            Indian cities — book, launch, and measure in minutes.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/browse-screens"
              className="group inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl"
              style={{
                background:
                  "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)",
                boxShadow: "0 12px 30px -10px rgba(47, 86, 224, 0.5)",
              }}
            >
              Browse screens
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full border border-base bg-surface px-7 py-3.5 text-sm font-semibold text-base transition hover:bg-elev"
            >
              Talk to sales
            </Link>
          </div>

          <div className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t divider-base pt-8">
            {[
              { value: "1500+", label: "Screens" },
              { value: "56", label: "Cities" },
              { value: "10Cr+", label: "Daily reach" },
            ].map((s) => (
              <div key={s.label}>
                <div
                  className="text-2xl font-bold md:text-3xl bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)",
                  }}
                >
                  {s.value}
                </div>
                <div className="mt-1 text-xs uppercase tracking-wider text-subtle">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="relative h-[520px] w-full [perspective:1200px]"
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 -z-10"
            animate={{ rotate: 360 }}
            transition={{ duration: 40, ease: "linear", repeat: Infinity }}
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(47,86,224,0.18) 60deg, transparent 120deg, rgba(31,196,207,0.18) 200deg, transparent 260deg, rgba(79,184,79,0.18) 320deg, transparent 360deg)",
              filter: "blur(60px)",
              borderRadius: "50%",
            }}
          />

          <motion.div
            initial={{ opacity: 0, x: 40, rotate: 8 }}
            animate={{ opacity: 1, x: 0, rotate: 3 }}
            transition={{ duration: 0.8, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ rotate: 0, scale: 1.04, y: -8, transition: { duration: 0.4 } }}
            className="absolute right-0 top-0 h-72 w-56 md:h-80 md:w-64 [transform-style:preserve-3d]"
          >
            <motion.div
              className="relative h-full w-full overflow-hidden rounded-3xl shadow-2xl ring-base"
              animate={{ y: [0, -14, 0] }}
              transition={{ duration: 6, ease: "easeInOut", repeat: Infinity }}
            >
              <Image
                src="/screen_in_blr/screen1.jpg"
                alt="Digital screen"
                fill
                className="object-cover"
                priority
              />
              <motion.div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
                }}
                animate={{ x: ["-120%", "120%"] }}
                transition={{ duration: 3.5, ease: "easeInOut", repeat: Infinity, repeatDelay: 2 }}
              />
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -40, rotate: -8 }}
            animate={{ opacity: 1, x: 0, rotate: -4 }}
            transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ rotate: 0, scale: 1.04, y: -8, transition: { duration: 0.4 } }}
            className="absolute left-0 top-16 h-64 w-52 md:h-72 md:w-60 [transform-style:preserve-3d]"
          >
            <motion.div
              className="relative h-full w-full overflow-hidden rounded-3xl shadow-2xl ring-base"
              animate={{ y: [0, 16, 0] }}
              transition={{ duration: 7, ease: "easeInOut", repeat: Infinity, delay: 0.5 }}
            >
              <Image
                src="/screen_in_blr/screen2.webp"
                alt="Digital screen"
                fill
                className="object-cover"
              />
              <motion.div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
                }}
                animate={{ x: ["-120%", "120%"] }}
                transition={{ duration: 3.5, ease: "easeInOut", repeat: Infinity, repeatDelay: 3, delay: 1.5 }}
              />
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 50, rotate: 6 }}
            animate={{ opacity: 1, y: 0, rotate: 2 }}
            transition={{ duration: 0.8, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ rotate: 0, scale: 1.04, y: -8, transition: { duration: 0.4 } }}
            className="absolute bottom-0 right-8 h-64 w-64 md:h-72 md:w-72 [transform-style:preserve-3d]"
          >
            <motion.div
              className="relative h-full w-full overflow-hidden rounded-3xl shadow-2xl ring-base"
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 5.5, ease: "easeInOut", repeat: Infinity, delay: 1 }}
            >
              <Image
                src="/screen_in_blr/screen3.webp"
                alt="Digital screen"
                fill
                className="object-cover"
              />
              <motion.div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
                }}
                animate={{ x: ["-120%", "120%"] }}
                transition={{ duration: 3.5, ease: "easeInOut", repeat: Infinity, repeatDelay: 2.5, delay: 0.8 }}
              />
            </motion.div>
          </motion.div>

          {[
            { top: "8%", left: "42%", size: 6, color: "var(--brand-blue)", delay: 0 },
            { top: "55%", left: "5%", size: 4, color: "var(--brand-cyan)", delay: 0.8 },
            { top: "80%", left: "48%", size: 5, color: "var(--brand-green)", delay: 1.4 },
            { top: "30%", left: "92%", size: 4, color: "var(--brand-lime)", delay: 2 },
          ].map((p, i) => (
            <motion.span
              key={i}
              aria-hidden
              className="absolute rounded-full"
              style={{
                top: p.top,
                left: p.left,
                width: p.size,
                height: p.size,
                background: p.color,
                boxShadow: `0 0 16px ${p.color}`,
              }}
              animate={{ y: [0, -22, 0], opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 4, repeat: Infinity, delay: p.delay, ease: "easeInOut" }}
            />
          ))}

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.85, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
            className="absolute bottom-6 left-0 z-10 flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-xl ring-base"
          >
            <motion.div
              className="relative flex h-10 w-10 items-center justify-center rounded-xl"
              style={{
                background:
                  "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)",
              }}
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-xl"
                style={{
                  background:
                    "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)",
                }}
                animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
              />
              <MapPin className="relative h-5 w-5 text-white" />
            </motion.div>
            <div>
              <div className="text-xs text-subtle">Live in</div>
              <div className="text-sm font-semibold text-base">
                Bengaluru · Mumbai · Delhi
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};

export default HeroSection;
