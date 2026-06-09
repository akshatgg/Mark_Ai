"use client";
import React from "react";
import { motion } from "framer-motion";
import { Megaphone, Building2, BarChart3, Film } from "lucide-react";

const features = [
  { icon: Megaphone, title: "Brand presence", desc: "High-impact placements that elevate your brand into city skylines, transit hubs and prime retail.", gradient: "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)" },
  { icon: Building2, title: "Prime locations", desc: "1,500+ screens across 56 cities, hand-picked for footfall, dwell-time and audience quality.", gradient: "linear-gradient(120deg, var(--brand-cyan) 0%, var(--brand-green) 100%)" },
  { icon: BarChart3, title: "Unlock potential", desc: "Live impression data, footfall analytics and campaign attribution baked into every booking.", gradient: "linear-gradient(120deg, var(--brand-green) 0%, var(--brand-lime) 100%)" },
  { icon: Film, title: "Engaging content", desc: "Anamorphic 3D, split-screen and motion-first creatives — built with Mark AI's creative tooling.", gradient: "linear-gradient(120deg, var(--brand-lime) 0%, var(--brand-cyan) 100%)" },
];

const WhyChooseUs = () => {
  return (
    <section className="relative w-full bg-elev py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">Why choose Mark AI</div>
          <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-base md:text-5xl">
            Everything you need to{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)" }}
            >
              ship a campaign
            </span>
            .
          </h2>
          <p className="mt-4 text-lg text-muted">
            From the first creative brief to live impression data — one platform, no spreadsheets.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="group relative overflow-hidden rounded-3xl border border-subtle bg-surface p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
              >
                <div
                  aria-hidden
                  className="absolute -top-12 -right-12 h-32 w-32 rounded-full opacity-0 blur-2xl transition group-hover:opacity-40"
                  style={{ background: f.gradient }}
                />
                <Icon className="relative h-7 w-7 text-base" strokeWidth={1.5} aria-hidden />
                <div aria-hidden className="relative mt-5 h-px w-10 divider-base border-t" />
                <h3 className="relative mt-4 text-lg font-bold text-base">{f.title}</h3>
                <p className="relative mt-2 text-sm leading-relaxed text-muted">{f.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default WhyChooseUs;
