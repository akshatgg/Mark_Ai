"use client";
import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

const CTABanner = () => {
  return (
    <section className="relative w-full bg-white py-20 md:py-24">
      <div className="mx-auto max-w-7xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="relative overflow-hidden rounded-[2.5rem] px-8 py-16 text-center shadow-2xl md:px-16 md:py-20"
          style={{
            background:
              "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 55%, var(--brand-green) 100%)",
          }}
        >
          <div
            aria-hidden
            className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full opacity-25 blur-3xl"
            style={{ background: "radial-gradient(circle, #ffffff 0%, transparent 70%)" }}
          />
          <div
            aria-hidden
            className="absolute -bottom-32 -right-24 h-[420px] w-[420px] rounded-full opacity-20 blur-3xl"
            style={{ background: "radial-gradient(circle, var(--brand-cyan) 0%, transparent 70%)" }}
          />

          <h2 className="relative mx-auto max-w-3xl text-3xl font-bold leading-tight tracking-tight text-white md:text-5xl">
            Ignite the power of DOOH advertising — today.
          </h2>
          <p className="relative mx-auto mt-5 max-w-2xl text-lg text-white/90">
            Get a curated screen plan for your brand, your geography and your
            budget — usually under 24 hours.
          </p>
          <div className="relative mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/contact"
              className="group inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-sm font-bold text-gray-900 shadow-lg transition hover:shadow-xl"
            >
              Let&apos;s connect
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </Link>
            <Link
              href="/browse-screens"
              className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-8 py-4 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20"
            >
              Browse screens
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default CTABanner;
