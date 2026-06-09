"use client";
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Search,
  Upload,
  BarChart3,
  Clock,
  CheckCircle2,
  TrendingUp,
  MapPin,
  Users,
  Target,
  ArrowRight,
  ArrowUpRight,
  Zap,
  Check,
  X,
} from "lucide-react";

const founders = [
  {
    name: "Danish Ashraf",
    role: "CEO & Co-founder",
    title: "10+ yrs digital advertising. Previously scaled DOOH networks.",
    image: "/about/danish.jpeg",
  },
  {
    name: "Poornima Murugiah",
    role: "COO & Co-founder",
    title: "Operations expert. Managed 200+ screen networks.",
    image: "/about/poornima-p.jpeg",
  },
];

const steps = [
  { number: "01", title: "Search screens", description: "Filter by city, audience and price.", icon: Search },
  { number: "02", title: "Book hourly slots", description: "No minimums. Hour or year — your call.", icon: Clock },
  { number: "03", title: "Upload creative", description: "Our team QAs it before going live.", icon: Upload },
  { number: "04", title: "Track views", description: "Live impressions + proof-of-play.", icon: BarChart3 },
];

const benefits = [
  { title: "No contracts, no minimums", desc: "Book 1 hour or 1 year. Pay only for confirmed plays.", icon: CheckCircle2 },
  { title: "Real proof-of-play", desc: "Escrow releases only after the screen operator confirms delivery.", icon: ShieldCheck },
  { title: "Audience-matched screens", desc: "Verified venues with TG, views and category fit on every listing.", icon: Target },
  { title: "RazorPay escrow", desc: "UPI, cards, wallets. Funds safe until your ad plays.", icon: Zap },
];

const stats = [
  { value: "30+", label: "Screens live in Bengaluru", icon: MapPin },
  { value: "15,000+", label: "Weekly views per screen", icon: Users },
  { value: "100%", label: "Proof-of-play verified", icon: CheckCircle2 },
  { value: "25+", label: "Audience categories", icon: TrendingUp },
];

const comparisonData = [
  { feature: "Booking", traditional: "Phone / email", markai: "Browser, 2 mins" },
  { feature: "Minimum spend", traditional: "₹50,000+", markai: "None" },
  { feature: "Proof-of-play", traditional: "Manual logs", markai: "Automatic CMS" },
  { feature: "Payment", traditional: "Invoice, 30 days", markai: "Escrow, pay-per-play" },
  { feature: "Audience data", traditional: "None", markai: "Per-screen TG" },
];

const BRAND_GRAD = "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)";
const BRAND_GRAD_FULL = "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 55%, var(--brand-green) 100%)";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const AboutSection = () => {
  return (
    <div className="w-full bg-base">
      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-28">
        <div
          aria-hidden
          className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--brand-blue) 0%, transparent 70%)" }}
        />
        <div
          aria-hidden
          className="absolute top-1/3 -right-32 h-[480px] w-[480px] rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--brand-cyan) 0%, transparent 70%)" }}
        />

        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-base bg-base/70 px-4 py-1.5 text-xs font-medium text-muted backdrop-blur">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--brand-green)" }} />
            About Mark AI
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-[1.05] tracking-tight text-base md:text-6xl lg:text-[64px]">
            Built for brands.{" "}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: BRAND_GRAD_FULL }}>
              Powered by data.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            Mark AI is the operating system for India&apos;s outdoor advertising — plan,
            book and measure DOOH campaigns across 1,500+ premium screens, all from one
            dashboard. No phone calls. No spreadsheets.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/browse-screens"
              className="group inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl"
              style={{ background: BRAND_GRAD, boxShadow: "0 12px 30px -10px rgba(47, 86, 224, 0.5)" }}
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
        </div>
      </section>

      {/* Stats strip */}
      <section className="relative bg-base pb-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid grid-cols-2 gap-4 rounded-3xl border border-subtle bg-elev p-6 shadow-sm md:grid-cols-4 md:p-10">
            {stats.map((s, i) => {
              const Icon = s.icon;
              return (
                <motion.div
                  key={s.label}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: "-60px" }}
                  variants={fadeUp}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="flex flex-col gap-2 text-center md:text-left"
                >
                  <Icon className="mx-auto h-5 w-5 text-subtle md:mx-0" strokeWidth={1.5} />
                  <div className="text-3xl font-bold text-base md:text-4xl">{s.value}</div>
                  <div className="text-sm text-muted">{s.label}</div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="bg-elev py-20 md:py-28">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-6 lg:grid-cols-2 lg:gap-20">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={fadeUp} transition={{ duration: 0.5 }}>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">Our mission</div>
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-base md:text-5xl">
              Make outdoor advertising{" "}
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: BRAND_GRAD }}>
                as easy as a Google Ad
              </span>
              .
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted">
              For 30 years, DOOH meant phone calls, lengthy negotiations and paperwork.
              We&apos;re fixing that — bringing programmatic-style booking, real-time
              measurement and audience-aware planning to every brand in India.
            </p>
            <ul className="mt-8 space-y-3 text-muted">
              {[
                "From discovery to live ad in under 24 hours",
                "Every impression backed by proof-of-play",
                "Audience targeting on real-world inventory",
              ].map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: BRAND_GRAD }} />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={fadeUp} transition={{ duration: 0.5, delay: 0.1 }} className="relative">
            <div className="relative aspect-[4/5] w-full max-w-md overflow-hidden rounded-[2rem] shadow-2xl ring-base">
              <Image src="/about_bg.jpg" alt="Mark AI" fill className="object-cover" />
            </div>
            <div className="absolute -bottom-6 -right-2 rounded-2xl bg-base p-5 shadow-2xl ring-base md:-right-6" style={{ minWidth: 220 }}>
              <div className="text-4xl font-extrabold bg-clip-text text-transparent" style={{ backgroundImage: BRAND_GRAD_FULL }}>
                24 hrs
              </div>
              <div className="mt-1 text-sm font-medium text-muted">Brief to live ad</div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-base py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">How it works</div>
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-base md:text-5xl">
              Four steps from{" "}
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: BRAND_GRAD }}>
                brief to billboard
              </span>
              .
            </h2>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={step.title}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: "-80px" }}
                  variants={fadeUp}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="relative rounded-3xl border border-subtle bg-base p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className="text-xs font-bold tracking-[0.2em] text-faint">{step.number}</div>
                  <Icon className="mt-4 h-7 w-7 text-base" strokeWidth={1.5} aria-hidden />
                  <div aria-hidden className="mt-5 h-px w-10 bg-gray-200" />
                  <h3 className="mt-4 text-lg font-bold text-base">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{step.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Why Mark AI */}
      <section className="bg-elev py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">Why Mark AI</div>
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-base md:text-5xl">
              Built for{" "}
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: BRAND_GRAD }}>
                modern marketing teams
              </span>
              .
            </h2>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((b, i) => {
              const Icon = b.icon;
              return (
                <motion.div
                  key={b.title}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: "-80px" }}
                  variants={fadeUp}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="rounded-3xl border border-subtle bg-base p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
                >
                  <Icon className="h-7 w-7 text-base" strokeWidth={1.5} aria-hidden />
                  <div aria-hidden className="mt-5 h-px w-10 bg-gray-200" />
                  <h3 className="mt-4 text-lg font-bold text-base">{b.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{b.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="bg-base py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">The difference</div>
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-base md:text-5xl">
              Traditional DOOH vs{" "}
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: BRAND_GRAD }}>
                Mark AI
              </span>
              .
            </h2>
          </div>

          <div className="mt-12 overflow-hidden rounded-3xl border border-subtle bg-base shadow-sm">
            <div className="grid grid-cols-3 border-b border-subtle bg-elev text-xs font-bold uppercase tracking-[0.15em] text-subtle">
              <div className="px-6 py-4">Feature</div>
              <div className="px-6 py-4">Traditional</div>
              <div className="px-6 py-4 text-base">Mark AI</div>
            </div>
            {comparisonData.map((row, i) => (
              <div
                key={row.feature}
                className={`grid grid-cols-3 items-center border-b border-subtle last:border-b-0 ${i % 2 === 0 ? "bg-base" : "bg-elev"}`}
              >
                <div className="px-6 py-5 text-sm font-semibold text-base">{row.feature}</div>
                <div className="flex items-center gap-2 px-6 py-5 text-sm text-muted">
                  <X className="h-4 w-4 shrink-0 text-faint" />
                  {row.traditional}
                </div>
                <div className="flex items-center gap-2 px-6 py-5 text-sm font-semibold text-base">
                  <Check className="h-4 w-4 shrink-0" style={{ color: "var(--brand-blue)" }} strokeWidth={3} />
                  {row.markai}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Founders */}
      <section className="bg-elev py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">Founders</div>
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-base md:text-5xl">
              The team{" "}
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: BRAND_GRAD }}>
                building Mark AI
              </span>
              .
            </h2>
          </div>

          <div className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-8 sm:grid-cols-2">
            {founders.map((f, i) => (
              <motion.div
                key={f.name}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-80px" }}
                variants={fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="overflow-hidden rounded-3xl border border-subtle bg-base shadow-sm transition hover:shadow-xl"
              >
                <div className="relative aspect-[4/3] w-full">
                  <Image src={f.image} alt={f.name} fill className="object-cover" />
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-bold text-base">{f.name}</h3>
                  <div className="mt-1 text-sm font-semibold bg-clip-text text-transparent" style={{ backgroundImage: BRAND_GRAD }}>
                    {f.role}
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{f.title}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
};

export default AboutSection;
