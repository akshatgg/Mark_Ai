"use client";
import React from 'react';
import { LegalDocument as LegalDocumentType, LegalSection } from '@/data/legal/types';
import ThemeToggle from '@/components/theme/ThemeToggle';

interface LegalDocumentProps {
  document: LegalDocumentType;
}

const LegalDocument: React.FC<LegalDocumentProps> = ({ document }) => {
  const renderContent = (content: string | string[]) => {
    if (typeof content === 'string') {
      return (
        <p className="leading-relaxed mb-4 text-base transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
          {content}
        </p>
      );
    }
    return (
      <ul className="list-disc list-inside space-y-3 mb-6 ml-4 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
        {content.map((item, index) => (
          <li key={index} className="leading-relaxed text-base pl-2">{item}</li>
        ))}
      </ul>
    );
  };

  const renderSection = (section: LegalSection, level: number = 0) => {
    const headingClass = level === 0
      ? "heading-font text-3xl font-bold mt-12 mb-6 tracking-wide transition-colors duration-300"
      : level === 1
      ? "heading-font text-2xl font-semibold mt-8 mb-4 tracking-wide transition-colors duration-300"
      : "heading-font text-xl font-medium mt-6 mb-3 tracking-wide transition-colors duration-300";

    return (
      <div key={section.id} className={`mb-${level === 0 ? '10' : '6'}`}>
        {section.title && (
          <h2 className={headingClass} style={{ color: 'var(--text-primary)' }}>
            <span style={{ color: 'var(--accent-blue)' }}>{section.id}.</span> {section.title}
          </h2>
        )}
        {section.content && renderContent(section.content)}
        {section.subsections && (
          <div className={level === 0 ? "ml-6" : "ml-4"}>
            {section.subsections.map((subsection) => renderSection(subsection, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="min-h-screen py-16 px-4 sm:px-6 lg:px-8 transition-colors duration-300"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* <ThemeToggle /> */}
      <div className="max-w-5xl mx-auto">
        {/* Header with Glassmorphism */}
        <div
          className="relative mb-12 overflow-hidden rounded-2xl transition-all duration-300"
          style={{
            background: 'linear-gradient(to right, rgba(59, 130, 246, 0.15), rgba(139, 92, 246, 0.15))',
            borderColor: 'var(--border-primary)'
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to bottom right, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1))'
            }}
          />
          <div className="relative z-10 px-8 py-10 md:px-12 md:py-12">
            <h1
              className="heading-font text-4xl md:text-5xl font-bold mb-3 tracking-wide transition-colors duration-300"
              style={{ color: 'var(--text-primary)' }}
            >
              {document.title}
            </h1>
            <p
              className="text-sm md:text-base font-medium transition-colors duration-300"
              style={{ color: 'var(--accent-blue)' }}
            >
              Last Updated: {document.lastUpdated}
            </p>
          </div>
        </div>

        {/* Main Content Card */}
        <div
          className="relative backdrop-blur-xl border rounded-2xl overflow-hidden transition-all duration-300"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-primary)'
          }}
        >
          <div className="px-8 py-10 md:px-12 md:py-12">
            {document.introduction && (
              <div
                className="mb-12 p-8 relative backdrop-blur-lg border-l-4 rounded-r-xl transition-all duration-300"
                style={{
                  backgroundColor: 'var(--bg-accent)',
                  borderLeftColor: 'var(--accent-blue)'
                }}
              >
                <h2
                  className="heading-font text-2xl font-bold mb-4 tracking-wide transition-colors duration-300"
                  style={{ color: 'var(--text-primary)' }}
                >
                  INTRODUCTION
                </h2>
                <div
                  className="leading-relaxed whitespace-pre-line text-base transition-colors duration-300"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {document.introduction}
                </div>
              </div>
            )}

            <div className="prose prose-lg max-w-none">
              {document.sections.map((section) => renderSection(section))}
            </div>

            {document.contactInfo && (
              <div
                className="mt-16 p-8 relative backdrop-blur-lg border-t-4 rounded-xl transition-all duration-300"
                style={{
                  background: 'linear-gradient(to bottom right, rgba(59, 130, 246, 0.08), rgba(139, 92, 246, 0.08))',
                  borderTopColor: 'var(--accent-blue)'
                }}
              >
                <h2
                  className="heading-font text-3xl font-bold mb-6 tracking-wide transition-colors duration-300"
                  style={{ color: 'var(--text-primary)' }}
                >
                  CONTACT US
                </h2>
                <div className="space-y-3" style={{ color: 'var(--text-secondary)' }}>
                  <p
                    className="heading-font text-xl font-semibold transition-colors duration-300"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {document.contactInfo.company}
                  </p>
                  <p className="flex items-center gap-2 text-base">
                    <span style={{ color: 'var(--accent-blue)' }}>📧</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>Email:</span>
                    <a
                      href={`mailto:${document.contactInfo.email}`}
                      className="transition-colors duration-200 underline underline-offset-4 hover:opacity-80"
                      style={{ color: 'var(--accent-blue)' }}
                    >
                      {document.contactInfo.email}
                    </a>
                  </p>
                  <p className="flex items-center gap-2 text-base">
                    <span style={{ color: 'var(--accent-blue)' }}>📞</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>Phone:</span>
                    <span>{document.contactInfo.phone}</span>
                  </p>
                  <p className="flex items-start gap-2 text-base">
                    <span className="mt-1" style={{ color: 'var(--accent-blue)' }}>🏢</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>Address:</span>
                    <span className="flex-1">{document.contactInfo.address}</span>
                  </p>
                  <p className="flex items-center gap-2 text-base">
                    <span style={{ color: 'var(--accent-blue)' }}>🌐</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>Website:</span>
                    <a
                      href={`https://${document.contactInfo.website}`}
                      className="transition-colors duration-200 underline underline-offset-4 hover:opacity-80"
                      style={{ color: 'var(--accent-blue)' }}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {document.contactInfo.website}
                    </a>
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Note */}
        <div className="max-w-5xl mx-auto mt-10 text-center">
          <p
            className="text-sm md:text-base transition-colors duration-300"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Thank you for using MarkAI. We're committed to providing a transparent, fair, and secure advertising marketplace.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LegalDocument;
