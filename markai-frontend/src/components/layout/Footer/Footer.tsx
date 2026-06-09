"use client";
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Twitter, Instagram, Linkedin, Mail, MapPin, Phone, ArrowUpRight } from "lucide-react";

const Footer = () => {
  const productLinks = [
    { title: "Browse Screens", href: "/browse-screens" },
    { title: "About", href: "/about" },
    { title: "Contact", href: "/contact" },
    { title: "Dashboard", href: "/dashboard" },
  ];

  const accountLinks = [
    { title: "Login", href: "/auth/login" },
    { title: "Sign Up", href: "/auth/signup" },
  ];

  const legalLinks = [
    { title: "Privacy Policy", href: "/privacy-policy" },
    { title: "Terms & Conditions", href: "/terms-condition" },
    { title: "Advertising Policy", href: "/advertising-policy" },
  ];

  const socialLinks = [
    { icon: Twitter, href: "https://twitter.com", label: "Twitter" },
    { icon: Instagram, href: "https://instagram.com", label: "Instagram" },
    { icon: Linkedin, href: "https://linkedin.com", label: "LinkedIn" },
  ];

  return (
    <footer className="relative w-full border-t border-base bg-base">
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{
          background:
            "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 55%, var(--brand-green) 100%)",
        }}
      />

      <div className="mx-auto max-w-7xl px-6 py-16 lg:py-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-5">
            <Link href="/" className="inline-flex items-center gap-3">
              <Image
                src="/mark_ai_logo2-removebg-preview.png"
                alt="Mark AI"
                width={44}
                height={44}
                className="h-10 w-10 object-contain"
              />
              <span
                className="text-2xl font-extrabold uppercase tracking-tight bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)",
                }}
              >
                Mark&nbsp;AI
              </span>
            </Link>

            <p className="mt-5 max-w-md text-base leading-relaxed text-muted">
              The operating system for India&apos;s outdoor advertising. Plan,
              book and measure DOOH campaigns across 1,500+ premium screens — all
              from one dashboard.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-muted">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                Bengaluru, India
              </li>
              <li className="flex items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                <a href="mailto:hello@mark-ai.tech" className="hover:text-base">
                  hello@mark-ai.tech
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                <a href="tel:+910000000000" className="hover:text-base">
                  +91 00000 00000
                </a>
              </li>
            </ul>

            <div className="mt-7 flex items-center gap-2">
              {socialLinks.map((s) => {
                const Icon = s.icon;
                return (
                  <Link
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-base text-muted transition hover:border-gray-300 hover:bg-elev hover:text-base"
                  >
                    <Icon size={18} />
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7">
            <FooterColumn title="Product" items={productLinks} />
            <FooterColumn title="Account" items={accountLinks} />
            <FooterColumn title="Legal" items={legalLinks} />
          </div>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-base pt-8 text-sm text-subtle sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Adneuron Pvt. Ltd. All rights reserved.</p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-1.5 font-semibold text-base transition hover:text-gray-700"
          >
            Start a campaign
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </footer>
  );
};

const FooterColumn = ({
  title,
  items,
}: {
  title: string;
  items: { title: string; href: string }[];
}) => (
  <div>
    <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-base">
      {title}
    </h3>
    <ul className="mt-5 space-y-3">
      {items.map((l) => (
        <li key={l.title}>
          <Link
            href={l.href}
            className="text-sm text-muted transition-colors duration-300 ease-out hover:text-[var(--brand-green)]"
          >
            {l.title}
          </Link>
        </li>
      ))}
    </ul>
  </div>
);

export default Footer;
