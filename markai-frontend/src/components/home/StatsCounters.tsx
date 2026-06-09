"use client";
import React, { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";

type Stat = {
  end: number;
  suffix: string;
  label: string;
  sub: string;
};

const stats: Stat[] = [
  { end: 1500, suffix: "+", label: "Digital screens", sub: "Across 56 cities" },
  { end: 2400, suffix: "+", label: "Campaigns executed", sub: "For 300+ brands" },
  { end: 10, suffix: " Cr+", label: "Daily audience reach", sub: "Verified impressions" },
];

const Counter = ({ end, suffix, duration = 1800 }: { end: number; suffix: string; duration?: number }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.floor(eased * end));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, end, duration]);

  return (
    <span ref={ref}>
      {value.toLocaleString("en-IN")}
      {suffix}
    </span>
  );
};

const StatsCounters = () => {
  return (
    <section
      className="relative w-full overflow-hidden py-20 md:py-24"
      style={{
        background:
          "linear-gradient(120deg, #0f1b3d 0%, #15356b 45%, #0b6e83 100%)",
      }}
    >
      <div
        aria-hidden
        className="absolute -top-32 -right-20 h-[420px] w-[420px] rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--brand-cyan) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-20 h-[420px] w-[420px] rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--brand-lime) 0%, transparent 70%)" }}
      />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
            Portfolio
          </div>
          <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-white md:text-5xl">
            Numbers that move{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(120deg, var(--brand-cyan) 0%, var(--brand-lime) 100%)",
              }}
            >
              real audiences
            </span>
            .
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-md"
            >
              <div
                className="text-5xl font-extrabold bg-clip-text text-transparent md:text-6xl"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, #ffffff 0%, var(--brand-cyan) 60%, var(--brand-lime) 100%)",
                }}
              >
                <Counter end={s.end} suffix={s.suffix} />
              </div>
              <div className="mt-3 text-lg font-semibold text-white">
                {s.label}
              </div>
              <div className="mt-1 text-sm text-white/60">{s.sub}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatsCounters;
