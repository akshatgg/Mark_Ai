"use client";
import ThemeToggle from '@/components/theme/ThemeToggle';

const RefundPolicyPage = () => {
  return (
    <div
      className="min-h-screen py-16 px-4 sm:px-6 lg:px-8 transition-colors duration-300"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <ThemeToggle />
      <div className="max-w-5xl mx-auto">
        {/* Header with Glassmorphism */}
        <div
          className="relative mb-12 overflow-hidden rounded-2xl backdrop-blur-xl border shadow-2xl transition-all duration-300"
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
              MARK AI REFUND POLICY
            </h1>
            <p
              className="text-sm md:text-base font-medium transition-colors duration-300"
              style={{ color: 'var(--accent-blue)' }}
            >
              Last Updated: January 23, 2026
            </p>
          </div>
        </div>

        {/* Main Content Card */}
        <div
          className="relative backdrop-blur-xl border rounded-2xl overflow-hidden shadow-2xl transition-all duration-300"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-primary)'
          }}
        >
          <div className="px-8 py-20 md:px-12 md:py-32">
            <div className="text-center">
              <div
                className="inline-block p-6 rounded-full mb-6 transition-all duration-300"
                style={{ backgroundColor: 'var(--bg-accent)' }}
              >
                <svg
                  className="w-16 h-16 transition-colors duration-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  style={{ color: 'var(--accent-blue)' }}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h2
                className="heading-font text-2xl font-bold mb-4 tracking-wide transition-colors duration-300"
                style={{ color: 'var(--text-primary)' }}
              >
                Content Coming Soon
              </h2>
              <p
                className="text-lg transition-colors duration-300"
                style={{ color: 'var(--text-tertiary)' }}
              >
                The Refund Policy content will be available shortly.
              </p>
            </div>
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
  )
}

export default RefundPolicyPage;