import Link from 'next/link';
import Script from 'next/script';
import { Logo } from '@/components/ui/Logo';
import { OpenChatButton } from '@/components/landing/OpenChatButton';

const demoWidgetId = process.env.NEXT_PUBLIC_DEMO_WIDGET_ID ?? '';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-background">
      {/* Navigation — minimal chrome */}
      <header className="sticky top-0 z-50 w-full border-b border-surface-border bg-white/90 backdrop-blur-sm">
        <nav
          className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5"
          aria-label="Global"
        >
          <Link href="/" className="flex items-center gap-2.5 cursor-pointer">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight text-gray-900">
              InboxPilot
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="cursor-pointer rounded px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors duration-150"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="cursor-pointer rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2"
            >
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero — AI-Native: conversational, minimal chrome */}
        <section className="relative overflow-hidden bg-gradient-to-b from-primary-50/60 via-white to-surface-background">
          <div className="mx-auto max-w-7xl px-6 pt-20 pb-16 lg:pt-28 lg:pb-24">
            <div className="mx-auto max-w-3xl text-center">
              {/* AI indicator — pulsing dot */}
              <div className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-primary-100 bg-white px-4 py-2 shadow-sm shadow-primary-100/50">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
                <span className="text-xs font-medium text-primary-700">
                  AI agent active
                </span>
              </div>

              {/* Headline */}
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-[3.25rem] lg:leading-[1.15]">
                Your AI support agent
                <br className="hidden sm:block" />
                that never sleeps
              </h1>

              {/* Subtitle */}
              <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-gray-500 sm:text-lg sm:leading-relaxed">
                InboxPilot reads every message, drafts instant replies using
                your knowledge base, and handles tickets across email and SMS
                — autonomously.
              </p>

              {/* CTAs */}
              <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <Link
                  href="/register"
                  className="group cursor-pointer w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded bg-primary px-6 py-3 text-sm font-medium text-white hover:bg-primary-600 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2"
                >
                  Start free trial
                  <svg
                    className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
                <Link
                  href="/login"
                  className="cursor-pointer w-full sm:w-auto inline-flex items-center justify-center rounded border border-surface-border bg-white px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2"
                >
                  Sign in to dashboard
                </Link>
                {demoWidgetId && (
                  <OpenChatButton
                    className="cursor-pointer w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded border border-primary-200 bg-primary-50 px-6 py-3 text-sm font-medium text-primary hover:bg-primary-100 hover:border-primary-300 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                      />
                    </svg>
                    Chat with us
                  </OpenChatButton>
                )}
              </div>

              <p className="mt-6 text-xs text-gray-400">
                No credit card required · AI starts learning in under 5 minutes
              </p>
            </div>
          </div>
        </section>

        {/* AI conversation demo — shows the product feel */}
        <section className="py-12 lg:py-16">
          <div className="mx-auto max-w-2xl px-6">
            <div className="rounded-lg border border-surface-border bg-white p-6 shadow-level-2">
              {/* Chat header */}
              <div className="flex items-center gap-3 pb-4 border-b border-surface-border">
                <div className="h-8 w-8 rounded-full bg-ai-50 flex items-center justify-center">
                  <span className="text-xs font-bold text-ai">AI</span>
                </div>
                <div>
                  <p className="text-body-md font-medium text-gray-900">InboxPilot Agent</p>
                  <p className="text-label-sm text-green-600 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Online · Responding in &lt;30s
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div className="mt-4 space-y-3">
                {/* Customer message */}
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-lg rounded-br-sm bg-primary px-4 py-2.5 text-sm text-white">
                    Hi, I&apos;d like to return an item I purchased last week. Order #4821
                  </div>
                </div>

                {/* AI response */}
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg rounded-bl-sm bg-gray-50 border border-surface-border px-4 py-2.5 text-sm text-gray-700">
                    <p>I&apos;d be happy to help with your return! I&apos;ve found order #4821. Per our policy, items can be returned within 30 days.</p>
                    <p className="mt-2">I&apos;ve initiated the return process and sent a prepaid shipping label to your email. Is there anything else I can help with?</p>
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-ai">
                      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                      </svg>
                      AI · 94% confidence · Knowledge base match
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="py-8 lg:py-12">
          <div className="mx-auto max-w-4xl px-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard value="< 30s" label="Avg. AI response time" />
              <StatCard value="94%" label="Knowledge accuracy" />
              <StatCard value="60%" label="Fully auto-resolved" />
            </div>
          </div>
        </section>

        {/* Features — AI-Native context cards with left accent */}
        <section className="border-t border-surface-border bg-white py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center mb-12 lg:mb-14">
              <p className="text-label-md uppercase tracking-widest text-primary mb-3">
                Capabilities
              </p>
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
                An AI agent that understands your business
              </h2>
              <p className="mt-4 max-w-lg mx-auto text-base text-gray-500 leading-relaxed">
                Grounded in your docs, trained on your tone, working 24/7
                across every channel.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                title="Knowledge-Grounded Replies"
                description="Every AI draft references your knowledge base. No hallucination — only answers backed by your docs."
                accent="primary"
              />
              <FeatureCard
                title="Multi-Channel Inbox"
                description="Email and SMS flow into one timeline. The AI handles both with the same context and accuracy."
                accent="primary"
              />
              <FeatureCard
                title="Confidence Scoring"
                description="Each AI response includes a confidence score. Low confidence? It routes to a human automatically."
                accent="green"
              />
              <FeatureCard
                title="Human-in-the-Loop"
                description="AI drafts, your team approves. One-click send or edit. Full control, zero bottleneck."
                accent="primary"
              />
              <FeatureCard
                title="Auto-Escalation"
                description="Detects frustration, legal keywords, or VIP accounts and escalates instantly to the right person."
                accent="amber"
              />
              <FeatureCard
                title="Real-Time Analytics"
                description="Track resolution rate, AI accuracy, response time, and CSAT — all updating live."
                accent="green"
              />
            </div>
          </div>
        </section>

        {/* How it works — streaming/conversational style */}
        <section className="border-t border-surface-border bg-surface-background py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center mb-12">
              <p className="text-label-md uppercase tracking-widest text-primary mb-3">
                Setup
              </p>
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
                Live in 3 steps
              </h2>
            </div>
            <div className="mx-auto max-w-2xl">
              <div className="space-y-0">
                <StepCard
                  step="1"
                  title="Connect channels"
                  description="Link email and SMS. InboxPilot syncs conversations in real-time."
                  isLast={false}
                />
                <StepCard
                  step="2"
                  title="Feed your knowledge"
                  description="Upload FAQs, policies, and docs. The AI indexes and understands them instantly."
                  isLast={false}
                />
                <StepCard
                  step="3"
                  title="Go live"
                  description="AI starts drafting replies. You review and approve — or let it auto-send when confident."
                  isLast={true}
                />
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-surface-border bg-white py-20 lg:py-24">
          <div className="mx-auto max-w-2xl px-6 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              Put your support on autopilot
            </h2>
            <p className="mt-4 text-base text-gray-500 leading-relaxed">
              Your AI agent is ready. Set up in minutes, no credit card required.
            </p>
            <div className="mt-8">
              <Link
                href="/register"
                className="group cursor-pointer inline-flex items-center gap-2 rounded bg-primary px-7 py-3.5 text-sm font-medium text-white hover:bg-primary-600 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2"
              >
                Deploy your AI agent
                <svg
                  className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-border bg-white py-8">
        <div className="mx-auto max-w-7xl px-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <Link href="/" className="flex items-center gap-2 cursor-pointer">
            <Logo size="sm" />
            <span className="text-sm font-medium text-gray-400">InboxPilot</span>
          </Link>
          <p className="text-xs text-gray-400">
            © {new Date().getFullYear()} InboxPilot. All rights reserved.
          </p>
        </div>
      </footer>

      {demoWidgetId && (
        <Script
          id="inboxpilot-landing-widget"
          src="/widget.js"
          strategy="lazyOnload"
          data-widget-id={demoWidgetId}
          data-position="bottom-right"
          data-color="#2563eb"
        />
      )}
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────────────────────────────── */

function FeatureCard({
  title,
  description,
  accent,
}: {
  title: string;
  description: string;
  accent: 'primary' | 'green' | 'amber';
}) {
  const accentColors = {
    primary: 'border-l-primary',
    green: 'border-l-green-500',
    amber: 'border-l-amber-500',
  };

  return (
    <div
      className={`rounded border border-surface-border bg-white p-5 border-l-[3px] ${accentColors[accent]} transition-colors duration-150 hover:bg-gray-50`}
    >
      <h3 className="text-[15px] font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">{description}</p>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center rounded border border-surface-border bg-white px-6 py-5 text-center">
      <span className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
        {value}
      </span>
      <span className="mt-1.5 text-sm text-gray-500">{label}</span>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
  isLast,
}: {
  step: string;
  title: string;
  description: string;
  isLast: boolean;
}) {
  return (
    <div className="relative flex gap-4 pb-8 last:pb-0">
      {/* Timeline */}
      <div className="flex flex-col items-center">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
          {step}
        </div>
        {!isLast && (
          <div className="mt-1.5 w-px flex-1 bg-primary-100" />
        )}
      </div>
      {/* Content */}
      <div className="pt-0.5 pb-1">
        <h3 className="text-[15px] font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">{description}</p>
      </div>
    </div>
  );
}
