"use client";
import React from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

type Props = {
  eyebrow: string;
  title: React.ReactNode;
  subtitle: string;
  bullets?: string[];
};

const AuthSidePanel = ({ eyebrow, title, subtitle, bullets = [] }: Props) => {
  return (
    <div className="relative flex justify-center overflow-hidden px-6 pt-24 pb-8 lg:px-12 lg:pt-24 lg:pb-10">
      <div
        aria-hidden
        className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--brand-blue) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -right-16 h-[420px] w-[420px] rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--brand-cyan) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="absolute right-1/4 top-1/3 h-[260px] w-[260px] rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--brand-lime) 0%, transparent 70%)" }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-lg flex-col">
        <p
          className="text-xs font-semibold uppercase tracking-[0.3em] bg-clip-text text-transparent"
          style={{
            backgroundImage:
              "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)",
          }}
        >
          {eyebrow}
        </p>

        <h1
          className="mt-4 text-3xl font-bold leading-tight tracking-tight lg:text-4xl xl:text-5xl"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h1>

        <p
          className="mt-4 text-base leading-relaxed lg:text-lg"
          style={{ color: "var(--text-secondary)" }}
        >
          {subtitle}
        </p>

        {bullets.length > 0 && (
          <ul className="mt-6 space-y-2.5">
            {bullets.map((b) => (
              <li
                key={b}
                className="flex items-start gap-3 text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white"
                  style={{
                    background:
                      "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)",
                  }}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {b}
              </li>
            ))}
          </ul>
        )}

        <div className="relative mt-8 hidden h-[300px] w-full max-w-[400px] xl:block [perspective:1200px]">
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
            initial={{ opacity: 0, x: 30, rotate: 8 }}
            animate={{ opacity: 1, x: 0, rotate: 3 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ rotate: 0, scale: 1.04, y: -6, transition: { duration: 0.4 } }}
            className="absolute right-4 top-0 h-44 w-32 [transform-style:preserve-3d]"
          >
            <motion.div
              className="relative h-full w-full overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10"
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 6, ease: "easeInOut", repeat: Infinity }}
            >
              <Image src="/screen_in_blr/screen1.jpg" alt="Digital screen" fill className="object-cover" />
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
            initial={{ opacity: 0, x: -30, rotate: -8 }}
            animate={{ opacity: 1, x: 0, rotate: -4 }}
            transition={{ duration: 0.8, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ rotate: 0, scale: 1.04, y: -6, transition: { duration: 0.4 } }}
            className="absolute left-0 top-8 h-40 w-28 [transform-style:preserve-3d]"
          >
            <motion.div
              className="relative h-full w-full overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10"
              animate={{ y: [0, 12, 0] }}
              transition={{ duration: 7, ease: "easeInOut", repeat: Infinity, delay: 0.5 }}
            >
              <Image src="/screen_in_blr/screen2.webp" alt="Digital screen" fill className="object-cover" />
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
            initial={{ opacity: 0, y: 30, rotate: 6 }}
            animate={{ opacity: 1, y: 0, rotate: 2 }}
            transition={{ duration: 0.8, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ rotate: 0, scale: 1.04, y: -6, transition: { duration: 0.4 } }}
            className="absolute bottom-0 left-20 h-40 w-40 [transform-style:preserve-3d]"
          >
            <motion.div
              className="relative h-full w-full overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 5.5, ease: "easeInOut", repeat: Infinity, delay: 1 }}
            >
              <Image src="/screen_in_blr/screen3.webp" alt="Digital screen" fill className="object-cover" />
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
        </div>
      </div>
    </div>
  );
};

export default AuthSidePanel;
