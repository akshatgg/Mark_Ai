"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Search,
  Clock,
  BarChart3,
  CheckCircle2,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import toast from "react-hot-toast";

const contactFormSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  topic: z.string().min(3, "Topic must be at least 3 characters"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

const BRAND_GRAD = "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)";
const BRAND_GRAD_FULL = "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 55%, var(--brand-green) 100%)";

const infoCards = [
  { icon: Search, title: "Real-time inventory search", desc: "Discover available DOOH screens instantly — filter by city, price, size and live availability." },
  { icon: Clock, title: "Hourly booking", desc: "Book screen time by the hour with conflict-free scheduling. Set frequency, control pacing." },
  { icon: BarChart3, title: "Analytics & proof-of-play", desc: "Track campaign performance with reach models, pacing indicators and exportable POP logs." },
];

const faqs = [
  {
    q: "How fast can my campaign go live?",
    a: "Most campaigns ship within 24 hours of the brief — once the creative is uploaded and QA'd, you're live on the next available slot.",
  },
  {
    q: "Is there a minimum spend?",
    a: "No. Book a single hour or a year-long campaign — you only pay for confirmed plays, verified by our CMS.",
  },
  {
    q: "How is proof-of-play handled?",
    a: "Every screen runs an integrated CMS that logs each play. Funds are held in RazorPay escrow and only released after confirmed delivery.",
  },
  {
    q: "Which cities are live right now?",
    a: "Bengaluru is live with 50+ premium screens. Mumbai, Delhi and Hyderabad are rolling out next.",
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const ContactSection = () => {
  const [isSuccess, setIsSuccess] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ContactFormData>({ resolver: zodResolver(contactFormSchema) });

  const onSubmit = async (data: ContactFormData) => {
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to send message");
      setIsSuccess(true);
      toast.success(result.message || "Message sent successfully!");
      reset();
      setTimeout(() => setIsSuccess(false), 5000);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to send message";
      toast.error(msg);
    }
  };

  return (
    <div className="w-full bg-base">
      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20">
        <div
          aria-hidden
          className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--brand-blue) 0%, transparent 70%)" }}
        />
        <div
          aria-hidden
          className="absolute top-1/3 -right-32 h-[480px] w-[480px] rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--brand-cyan) 0%, transparent 70%)" }}
        />

        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-base bg-surface px-4 py-1.5 text-xs font-medium text-muted backdrop-blur">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--brand-green)" }} />
            We reply within 24 hours
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-[1.05] tracking-tight text-base md:text-6xl">
            Let&apos;s build your next{" "}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: BRAND_GRAD_FULL }}>
              DOOH campaign
            </span>
            .
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            Tell us about your brand, your geography and your budget. We&apos;ll put together
            a curated screen plan — usually under 24 hours.
          </p>
        </div>
      </section>

      {/* Contact form + info */}
      <section className="relative pb-20 md:pb-28">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 lg:grid-cols-5">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="lg:col-span-3 rounded-3xl border border-subtle bg-surface p-6 shadow-sm md:p-10"
          >
            <h2 className="text-2xl font-bold tracking-tight text-base md:text-3xl">Send us a message</h2>
            <p className="mt-2 text-sm text-muted">Fill the form below and our team will get back to you.</p>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
              <Field label="Full name" error={errors.fullName?.message}>
                <input
                  type="text"
                  placeholder="Your full name"
                  {...register("fullName")}
                  className="w-full rounded-xl border border-base bg-base px-4 py-3 text-sm text-base placeholder:text-faint outline-none focus:border-[var(--brand-blue)] focus:ring-4 focus:ring-[var(--brand-blue)]/15 transition"
                />
              </Field>

              <Field label="Work email" error={errors.email?.message}>
                <input
                  type="email"
                  placeholder="you@brand.com"
                  {...register("email")}
                  className="w-full rounded-xl border border-base bg-base px-4 py-3 text-sm text-base placeholder:text-faint outline-none focus:border-[var(--brand-blue)] focus:ring-4 focus:ring-[var(--brand-blue)]/15 transition"
                />
              </Field>

              <Field label="Topic" error={errors.topic?.message}>
                <input
                  type="text"
                  placeholder="Campaign enquiry, partnership, support…"
                  {...register("topic")}
                  className="w-full rounded-xl border border-base bg-base px-4 py-3 text-sm text-base placeholder:text-faint outline-none focus:border-[var(--brand-blue)] focus:ring-4 focus:ring-[var(--brand-blue)]/15 transition"
                />
              </Field>

              <Field label="Message" error={errors.message?.message}>
                <textarea
                  rows={5}
                  placeholder="Tell us about your brand, target audience and budget."
                  {...register("message")}
                  className="w-full rounded-xl border border-base bg-base px-4 py-3 text-sm text-base placeholder:text-faint outline-none focus:border-[var(--brand-blue)] focus:ring-4 focus:ring-[var(--brand-blue)]/15 transition resize-y"
                />
              </Field>

              <button
                type="submit"
                disabled={isSubmitting}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl disabled:opacity-70"
                style={{ background: BRAND_GRAD, boxShadow: "0 12px 30px -10px rgba(47, 86, 224, 0.5)" }}
              >
                {isSubmitting ? "Sending…" : isSuccess ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Message sent
                  </>
                ) : (
                  <>
                    Send message
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="lg:col-span-2 space-y-5"
          >
            <div className="rounded-3xl border border-subtle bg-surface p-6 shadow-sm md:p-7">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">Reach us</div>
              <ul className="mt-5 space-y-4 text-sm">
                <ContactRow icon={<Mail className="h-4 w-4" />} label="Email" value="hello@mark-ai.tech" href="mailto:hello@mark-ai.tech" />
                <ContactRow icon={<Phone className="h-4 w-4" />} label="Phone" value="+91 00000 00000" href="tel:+910000000000" />
                <ContactRow icon={<MapPin className="h-4 w-4" />} label="Office" value="Bengaluru, India" />
              </ul>
            </div>

            {infoCards.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.title} className="rounded-3xl border border-subtle bg-surface p-6 shadow-sm">
                  <Icon className="h-6 w-6 text-base" strokeWidth={1.5} />
                  <div aria-hidden className="mt-4 h-px w-10 divider-base border-t" />
                  <h3 className="mt-3 text-base font-bold text-base">{c.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{c.desc}</p>
                </div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* FAQs */}
      <section className="bg-elev py-20 md:py-28">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">FAQs</div>
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-base md:text-5xl">
              Common{" "}
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: BRAND_GRAD }}>
                questions
              </span>
              .
            </h2>
          </div>

          <Accordion type="single" collapsible className="mt-10 space-y-3">
            {faqs.map((faq, i) => (
              <AccordionItem
                key={faq.q}
                value={`item-${i}`}
                className="rounded-2xl border border-subtle bg-surface px-5 shadow-sm"
              >
                <AccordionTrigger className="py-5 text-left text-base font-semibold text-base hover:no-underline">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="pb-5 text-sm leading-relaxed text-muted">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>
    </div>
  );
};

const Field = ({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) => (
  <div>
    <label className="mb-1.5 block text-sm font-semibold text-base">{label}</label>
    {children}
    {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
  </div>
);

const ContactRow = ({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) => {
  const inner = (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-base bg-elev text-base">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-subtle">{label}</div>
        <div className="mt-0.5 truncate text-sm font-medium text-base">{value}</div>
      </div>
    </div>
  );
  if (href) return <li><a href={href} className="block transition hover:opacity-80">{inner}</a></li>;
  return <li>{inner}</li>;
};

export default ContactSection;
