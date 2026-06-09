"use client";
import React from "react";
import Link from "next/link";
import { ArrowLeft, Mail, Phone, Globe, MapPin } from "lucide-react";
import { LegalDocument as LegalDocumentType, LegalSection } from "@/data/legal/types";

interface LegalDocumentProps {
  document: LegalDocumentType;
}

const BRAND_GRAD_FULL =
  "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 55%, var(--brand-green) 100%)";

const renderContent = (content: string | string[]) => {
  if (typeof content === "string") {
    return <p className="mb-4 text-base leading-relaxed text-muted">{content}</p>;
  }
  return (
    <ul className="mb-6 ml-4 list-disc space-y-3 text-muted">
      {content.map((item, i) => (
        <li key={i} className="pl-2 text-base leading-relaxed">
          {item}
        </li>
      ))}
    </ul>
  );
};

const renderSection = (section: LegalSection, level = 0): React.ReactNode => {
  const headingClass =
    level === 0
      ? "text-2xl md:text-3xl font-bold mt-12 mb-5 tracking-tight"
      : level === 1
      ? "text-xl md:text-2xl font-semibold mt-8 mb-4 tracking-tight"
      : "text-lg font-semibold mt-6 mb-3 tracking-tight";

  return (
    <div key={section.id} className={level === 0 ? "mb-10" : "mb-6"}>
      {section.title && (
        <h2 className={`${headingClass} text-base`}>
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: BRAND_GRAD_FULL }}
          >
            {section.id}.
          </span>{" "}
          {section.title}
        </h2>
      )}
      {section.content && renderContent(section.content)}
      {section.subsections && (
        <div className={level === 0 ? "ml-6" : "ml-4"}>
          {section.subsections.map((s) => renderSection(s, level + 1))}
        </div>
      )}
    </div>
  );
};

const LegalDocument: React.FC<LegalDocumentProps> = ({ document }) => {
  return (
    <div className="relative min-h-screen overflow-hidden bg-base pt-28 pb-16 md:pt-32">
      <div
        aria-hidden
        className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full opacity-25 blur-3xl"
        style={{
          background: "radial-gradient(circle, var(--brand-blue) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-1/3 -right-32 h-[420px] w-[420px] rounded-full opacity-20 blur-3xl"
        style={{
          background: "radial-gradient(circle, var(--brand-cyan) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-4xl px-6">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-subtle transition hover:text-base"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <div className="rounded-3xl border border-subtle bg-surface p-6 shadow-sm md:p-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-base bg-base px-3 py-1 text-xs font-medium text-muted">
            Last updated · {document.lastUpdated}
          </span>
          <h1 className="mt-4 text-4xl font-bold leading-[1.1] tracking-tight text-base md:text-5xl">
            {document.title}
          </h1>

          {document.introduction && (
            <div
              className="mt-8 rounded-2xl border-l-4 bg-elev p-6"
              style={{ borderLeftColor: "var(--brand-blue)" }}
            >
              <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-subtle">
                Introduction
              </h2>
              <div className="mt-3 whitespace-pre-line text-base leading-relaxed text-muted">
                {document.introduction}
              </div>
            </div>
          )}

          <div className="mt-2">
            {document.sections.map((s) => renderSection(s))}
          </div>

          {document.contactInfo && (
            <div className="mt-12 rounded-2xl border border-subtle bg-elev p-6 md:p-8">
              <h2 className="text-xl font-bold tracking-tight text-base">Contact us</h2>
              <p className="mt-1 text-sm font-semibold text-muted">
                {document.contactInfo.company}
              </p>

              <ul className="mt-5 space-y-3 text-sm">
                <ContactRow
                  icon={<Mail className="h-4 w-4" />}
                  label="Email"
                  value={document.contactInfo.email}
                  href={`mailto:${document.contactInfo.email}`}
                />
                <ContactRow
                  icon={<Phone className="h-4 w-4" />}
                  label="Phone"
                  value={document.contactInfo.phone}
                />
                <ContactRow
                  icon={<MapPin className="h-4 w-4" />}
                  label="Address"
                  value={document.contactInfo.address}
                />
                <ContactRow
                  icon={<Globe className="h-4 w-4" />}
                  label="Website"
                  value={document.contactInfo.website}
                  href={`https://${document.contactInfo.website}`}
                  external
                />
              </ul>
            </div>
          )}
        </div>

        <p className="mt-8 text-center text-sm text-subtle">
          Thank you for using Mark AI. We&apos;re committed to a transparent, fair, and
          secure advertising marketplace.
        </p>
      </div>
    </div>
  );
};

const ContactRow = ({
  icon,
  label,
  value,
  href,
  external = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
  external?: boolean;
}) => {
  const valueNode = href ? (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="font-medium text-base underline-offset-4 transition hover:underline"
    >
      {value}
    </a>
  ) : (
    <span className="font-medium text-base">{value}</span>
  );
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-base bg-base text-base">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-subtle">{label}</div>
        <div className="mt-0.5">{valueNode}</div>
      </div>
    </li>
  );
};

export default LegalDocument;
