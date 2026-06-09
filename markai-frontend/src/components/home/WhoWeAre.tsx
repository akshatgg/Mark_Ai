"use client";
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

const WhoWeAre = () => {
  return (
    <section className="relative w-full bg-base py-20 md:py-28">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-6 lg:grid-cols-2 lg:gap-20">
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="relative"
        >
          <div className="relative aspect-[4/5] w-full max-w-md overflow-hidden rounded-[2rem] shadow-2xl ring-base">
            <Image src="/about_bg.jpg" alt="Digital screens across India" fill className="object-cover" />
          </div>
          <div
            className="absolute -bottom-6 -right-2 rounded-2xl bg-surface p-5 shadow-2xl ring-base md:-right-6"
            style={{ minWidth: 200 }}
          >
            <div
              className="text-4xl font-extrabold bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 55%, var(--brand-green) 100%)",
              }}
            >
              56 Cities
            </div>
            <div className="mt-1 text-sm font-medium text-muted">1,500+ premium screens</div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">Who we are</div>
          <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-base md:text-5xl">
            India&apos;s largest{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)" }}
            >
              premium DOOH
            </span>{" "}
            media network.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-muted">
            We power brand campaigns across high-impact digital screens in malls, airports,
            transit hubs, and prime urban corridors. Backed by Xibo-based playout, real-time
            analytics and Mark AI&apos;s creative tooling — every campaign is measurable,
            programmable, and unmissable.
          </p>

          <ul className="mt-8 space-y-3 text-muted">
            {[
              "Plan, book and launch in a single workflow",
              "Anamorphic, split-screen and motion-first creatives",
              "Live impressions and footfall analytics",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span
                  className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)" }}
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/about"
            className="mt-10 inline-flex items-center gap-2 text-sm font-semibold text-base transition hover:opacity-80"
          >
            Learn more about Mark AI
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
};

export default WhoWeAre;
