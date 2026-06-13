import Link from 'next/link';
import Script from 'next/script';
import {
  Radio,
  Quote,
  TriangleAlert,
  ListOrdered,
  ShieldCheck,
  ScrollText,
} from 'lucide-react';
import { Topbar } from '@/components/Topbar';

const demoWidgetId = process.env.NEXT_PUBLIC_DEMO_WIDGET_ID ?? '';

export default function HomePage() {
  return (
    <div
      className="m03 flex min-h-screen flex-col bg-white text-[var(--m03-fg)]"
      style={{
        fontFamily: 'var(--font-inter), Inter, system-ui, -apple-system, sans-serif',
        fontFeatureSettings: "'cv02', 'cv03', 'cv04', 'cv11'",
      }}
    >
      <Topbar nav={[{ label: 'Features', href: '#features' }]} />

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-[920px] px-6 pt-[88px] pb-16 text-center">
          <span className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--m03-fg-2)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--m03-green)]" />
            Now with webchat channels
          </span>
          <h1 className="mb-4 text-[64px] font-medium leading-[1.0] tracking-[-0.04em] text-[var(--m03-fg)]">
            The shared inbox
            <br />
            that actually replies.
          </h1>
          <p className="mx-auto mb-8 max-w-[600px] text-[18px] leading-[1.55] text-[var(--m03-fg-2)]">
            InboxPilot drafts, sends, and escalates customer messages across SMS, email, and webchat
            — with a knowledge base that grounds every AI reply in your real policies.
          </p>
          <div className="flex justify-center gap-2.5">
            <Link
              href="/register"
              className="rounded bg-[var(--m03-fg)] px-5 py-2.5 text-[14px] font-medium text-[var(--m03-bg)] hover:bg-[var(--m03-fg-2)]"
            >
              Start free →
            </Link>
            <Link
              href="#features"
              className="rounded border border-[var(--m03-line)] px-5 py-2.5 text-[14px] font-medium text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)]"
            >
              See features
            </Link>
          </div>
          <div className="mt-12 flex justify-center gap-8 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--m03-fg-3)]">
            <span>
              <strong className="font-medium text-[var(--m03-fg)]">10k+</strong> conversations/day
            </span>
            <span>·</span>
            <span>
              <strong className="font-medium text-[var(--m03-fg)]">92%</strong> AI accuracy
            </span>
            <span>·</span>
            <span>
              <strong className="font-medium text-[var(--m03-fg)]">&lt;2s</strong> p95 reply
            </span>
          </div>
        </section>

        {/* Product preview */}
        <section className="px-6 pb-20">
          <div className="mx-auto max-w-[1100px] overflow-hidden rounded-lg border border-[var(--m03-line)] bg-white shadow-[0_30px_80px_rgba(0,0,0,0.08)]">
            {/* Browser bar */}
            <div className="flex items-center gap-2 border-b border-[var(--m03-line)] bg-[var(--m03-line-2)] px-4 py-2.5">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--m03-line)]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--m03-line)]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--m03-line)]" />
              </div>
              <div className="mx-auto max-w-[320px] flex-1 rounded bg-white px-3 py-1 text-center font-mono text-[11px] text-[var(--m03-fg-2)]">
                app.inboxpilot.com/inbox
              </div>
            </div>
            {/* Body */}
            <div className="grid min-h-[420px] grid-cols-[200px_1fr]">
              {/* Sidebar */}
              <div className="border-r border-[var(--m03-line)] bg-[var(--m03-line-2)] py-3.5 px-2">
                <div className="px-2.5 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--m03-fg-3)]">
                  Workspace
                </div>
                <PreviewRow active icon="▶" label="Inbox" badge="24" />
                <PreviewRow icon="★" label="Mentions" />
                <PreviewRow icon="⏱" label="Snoozed" />
                <PreviewRow icon="✓" label="Done" />
                <div className="px-2.5 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--m03-fg-3)]">
                  Channels
                </div>
                <PreviewRow icon="■" label="SMS" />
                <PreviewRow icon="■" label="Email" />
                <PreviewRow icon="■" label="Webchat" />
              </div>
              {/* Conversation */}
              <div className="flex flex-col gap-2 bg-white p-[18px]">
                <div className="msg in max-w-[60%] self-start rounded-lg bg-[var(--m03-line-2)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--m03-fg)]">
                  Hi, I was charged on the 14th and the refund was supposed to land in 3–5 business
                  days. It&rsquo;s day 6.
                </div>
                <div className="msg ai max-w-[60%] self-start rounded-lg border border-[var(--m03-green)] bg-white px-3 py-2 text-[12px] leading-[1.5] text-[var(--m03-fg)]">
                  <span className="mb-0.5 block font-mono text-[9px] font-semibold uppercase tracking-wider text-[var(--m03-green)]">
                    AI • 92% conf
                  </span>
                  I checked your account and the refund was issued on the 15th — it should appear in
                  1–2 more business days. If it doesn&rsquo;t land by Friday I&rsquo;ll personally
                  escalate.
                </div>
                <div className="msg out max-w-[60%] self-end rounded-lg bg-[var(--m03-fg)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--m03-bg)]">
                  Thanks for following up so fast.
                </div>
                <div className="msg in max-w-[60%] self-start rounded-lg bg-[var(--m03-line-2)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--m03-fg)]">
                  That worked, it just landed. Lifesaver.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-[1100px] px-6 py-16 scroll-mt-20">
          <h2 className="mb-12 text-center text-[40px] font-medium tracking-[-0.03em]">
            Built for support teams that ship
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-[var(--m03-line)] bg-white p-6"
              >
                <div className="mb-4 flex h-8 w-8 items-center justify-center rounded bg-[var(--m03-line-2)] text-[var(--m03-fg)]">
                  <f.icon size={16} strokeWidth={1.75} />
                </div>
                <h3 className="mb-1.5 text-[14px] font-semibold text-[var(--m03-fg)]">
                  {f.title}
                </h3>
                <p className="text-[12px] leading-[1.6] text-[var(--m03-fg-2)]">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="flex items-center border-t border-[var(--m03-line)] px-6 py-8 text-[12px] text-[var(--m03-fg-3)]">
        <span>© 2026 InboxPilot</span>
      </footer>

      {demoWidgetId && (
        <Script
          id="inboxpilot-landing-widget"
          src="/widget.js"
          strategy="lazyOnload"
          data-widget-id={demoWidgetId}
          data-position="bottom-right"
          data-color="#0070f3"
        />
      )}
    </div>
  );
}

const features: Array<{ icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; title: string; body: string }> = [
  {
    icon: Radio,
    title: 'Multi-channel inbox',
    body: 'SMS, email, and webchat in one place. Provider-neutral adapters mean no lock-in to Twilio or Postmark.',
  },
  {
    icon: Quote,
    title: 'Grounded AI replies',
    body: "Every draft cites your knowledge base. No invented policies, no chain-of-thought in production logs.",
  },
  {
    icon: TriangleAlert,
    title: 'Deterministic escalation',
    body: 'Profanity, legal threats, refunds, billing errors — caught by rules before any LLM call. Cost down, safety up.',
  },
  {
    icon: ListOrdered,
    title: 'Postgres job queue',
    body: 'No Redis, no BullMQ. SELECT FOR UPDATE SKIP LOCKED does the work, with exponential backoff and dead-lettering.',
  },
  {
    icon: ShieldCheck,
    title: 'Row-level security',
    body: "Tenants can't see each other's data. Ever. The platform's RLS policies are unit-tested with a real probe matrix.",
  },
  {
    icon: ScrollText,
    title: 'Audit logs by default',
    body: 'Every AI decision, every escalation, every credential change — append-only and exportable for compliance.',
  },
];

function PreviewRow({
  icon,
  label,
  badge,
  active,
}: {
  icon: string;
  label: string;
  badge?: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-[12px] ${
        active
          ? 'bg-[var(--m03-fg)] text-[var(--m03-bg)]'
          : 'text-[var(--m03-fg-2)]'
      }`}
    >
      <span className={active ? 'text-[var(--m03-bg)]' : 'text-[var(--m03-fg-3)]'}>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge && (
        <span
          className={`font-mono text-[10px] ${
            active ? 'text-[var(--m03-bg)]' : 'text-[var(--m03-green)]'
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}
