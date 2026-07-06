"use client";
import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Twitter, Instagram, Linkedin, Github } from 'lucide-react';

const Footer = () => {
  const quickLinks = [
    { title: "Home", href: "/" },
    { title: "About", href: "/about" },
    { title: "Browse Screens", href: "/browse-screens" },
    { title: "Contact", href: "/contact" },
  ];

  const accountLinks = [
    { title: "Login", href: "/auth/login" },
    { title: "Sign Up", href: "/auth/signup" },
    { title: "Dashboard", href: "/dashboard" },
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
    { icon: Github, href: "https://github.com", label: "GitHub" },
  ];

  return (
    <footer className="relative w-full">
      {/* Glassmorphism background */}
      <div
        className="absolute inset-0 backdrop-blur-xl border-t transition-colors duration-300"
        style={{
          background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01))',
          borderTopColor: 'var(--border-primary)'
        }}
      />

      <div className="relative z-10 md:w-[85%] mx-auto px-6 py-12 md:py-16">
        {/* Top Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-12 mb-12">
          {/* Left Section - Logo and Description */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-3 mb-4 hover:opacity-80 transition-opacity cursor-pointer">
              <Image
                src="/mark_ai_logo2-removebg-preview.png"
                alt="MarkAI Logo"
                width={40}
                height={40}
                className="h-10 w-auto object-contain"
              />
              <h2 className="text-2xl font-bold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                Mark AI
              </h2>
            </Link>
            <p className="text-sm leading-relaxed mb-6 max-w-md transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                Mark AI - Meta for Outdoor Ads
                For brands and agencies in India. Plan, book, and track DOOH campaigns on one simple dashboard.
            </p>
            {/* Social Media Links */}
            <div className="flex items-center gap-4">
              {socialLinks.map((social) => {
                const Icon = social.icon;
                return (
                  <Link
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors duration-200 p-2 rounded-lg"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--text-primary)';
                      e.currentTarget.style.backgroundColor = 'var(--bg-accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-secondary)';
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                    aria-label={social.label}
                  >
                    <Icon size={20} />
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Right Section - Navigation Links */}
          <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-8">
            {/* Quick Links Column */}
            <div>
              <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                Quick Links
              </h3>
              <ul className="space-y-3">
                {quickLinks.map((link) => (
                  <li key={link.title}>
                    <Link
                      href={link.href}
                      className="text-sm transition-colors duration-200"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                    >
                      {link.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Account Column */}
            <div>
              <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                Account
              </h3>
              <ul className="space-y-3">
                {accountLinks.map((link) => (
                  <li key={link.title}>
                    <Link
                      href={link.href}
                      className="text-sm transition-colors duration-200"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                    >
                      {link.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal Column */}
            <div>
              <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                Legal
              </h3>
              <ul className="space-y-3">
                {legalLinks.map((link) => (
                  <li key={link.title}>
                    <Link
                      href={link.href}
                      className="text-sm transition-colors duration-200"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                    >
                      {link.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="pt-8 border-t flex flex-col sm:flex-row justify-between items-center gap-4 transition-colors duration-300" style={{ borderTopColor: 'var(--border-primary)' }}>
          <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
            © 2026 Adneuron Pvt. Ltd. All rights reserved.
          </p>
          <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
            Made with ❤️ in India
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;