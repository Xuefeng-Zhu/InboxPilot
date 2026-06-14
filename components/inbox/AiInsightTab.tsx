'use client';

import { useAiDecision } from '@/lib/queries/hooks/useAiDecision';
import { formatResponseTime } from '@/lib/utils/format-response-time';
import type { ConversationRow } from './ConversationItem';

// ---------------------------------------------------------------------------
// AiInsightTab — M03 right-panel "AI Insight" tab body.
//
// Renders an 8-section view of the latest `ai_decisions` row for the supplied
// conversation, mirroring the original `cb6730a` `AiInsightPanel`
// (`components/inbox/MessageThread.tsx` lines 320-440) with a full M03 token
// remap so the section colors match the rest of the right-rail palette.
//
//   1. Status + Confidence row (color-coded by `ai_state` + confidence %)
//   2. Decision type chip
//   3. Reasoning card
//   4. Tags pills (up to 5)
//   5. Sources pills (or "Knowledge Base" fallback)
//   6. Response Time (via `formatResponseTime(decision.created_at, last_message_at)`)
//   7. `requires_human` warning banner (orange M03)
//   8. Suggested Actions buttons (visual only — no `onClick`, no mutations)
//
// Early returns (BEFORE the main render):
//   - `aiState === 'idle'` AND `decision === null`  → "No AI activity yet"
//   - `isLoading === true`                         → spinner + "Loading insights…"
//
// M03 token remap applied (legacy colour names → M03):
//   - Yellow utilities (no M03 equivalent)    → var(--m03-orange-*) family
//   - AI-brand utilities (no M03 equivalent)  → var(--m03-orange)
//   - Green 50 / 600 / 700 utilities          → var(--m03-green-*) family
//   - Red 50 / 600 / 700 utilities            → var(--m03-red-*) family
//   - Gray 50 / 100 utilities                 → var(--m03-line-2) / var(--m03-line)
//   - Generic gray text utilities             → var(--m03-fg-2) / var(--m03-fg-3)
//   - Custom surface border utility           → var(--m03-line)
// ---------------------------------------------------------------------------

/** Raw `ai_decisions` row from PostgREST. Matches `001_initial_schema.sql`
 *  lines 219-232. The hook returns untyped PostgREST data, so we cast at
 *  the call site. */
interface AiDecisionRow {
  id: string;
  conversation_id: string;
  organization_id: string;
  message_id: string | null;
  decision_type: string;
  confidence: number;
  reasoning_summary: string | null;
  response_text: string | null;
  tags: string[];
  requires_human: boolean;
  raw_response: Record<string, unknown> | null;
  created_at: string;
}

interface AiInsightTabProps {
  conversation: ConversationRow;
}

const STATUS_LABEL: Record<ConversationRow['ai_state'], string> = {
  idle: 'Idle',
  thinking: 'Analyzing…',
  drafted: 'Draft Ready',
  auto_replied: 'Auto Replied',
  needs_human: 'Needs Human',
  failed: 'Failed',
};

const STATUS_COLOR: Record<ConversationRow['ai_state'], string> = {
  idle: 'text-[var(--m03-fg-3)]',
  thinking: 'text-[var(--m03-orange)]',
  drafted: 'text-[var(--m03-green)]',
  auto_replied: 'text-[var(--m03-green)]',
  needs_human: 'text-[var(--m03-orange)]',
  failed: 'text-[var(--m03-red)]',
};

function getConfidenceClass(percent: number): string {
  if (percent >= 75) {
    return 'bg-[var(--m03-green-fill)] text-[var(--m03-green)] border border-[var(--m03-green-line)]';
  }
  if (percent >= 50) {
    return 'bg-[var(--m03-orange-fill)] text-[var(--m03-orange)] border border-[var(--m03-orange-line)]';
  }
  return 'bg-[var(--m03-red-fill)] text-[var(--m03-red)] border border-[var(--m03-red-line)]';
}

function StatusIcon({ aiState }: { aiState: ConversationRow['ai_state'] }) {
  const colorClass = STATUS_COLOR[aiState];
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={colorClass}
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
      {(aiState === 'drafted' || aiState === 'auto_replied') && (
        <path
          d="M4.5 7l2 2 3.5-3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {aiState === 'thinking' && (
        <path
          d="M7 1a6 6 0 0 1 6 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
      {aiState === 'needs_human' && (
        <>
          <path d="M7 4v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M7 9.5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
      {aiState === 'failed' && (
        <>
          <path d="M4.5 4.5l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M9.5 4.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
      {aiState === 'idle' && (
        <path
          d="M7 4v3l2 1.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export function AiInsightTab({ conversation }: AiInsightTabProps) {
  const aiState = conversation.ai_state;
  const { data, isLoading } = useAiDecision(conversation.id);
  const decision = (data as AiDecisionRow | null) ?? null;

  // Early return: idle + no decision → empty state.
  if (aiState === 'idle' && decision === null) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--m03-line-2)]">
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-[var(--m03-fg-3)]"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="9" cy="9" r="7" />
            <path d="M9 6v3l2 1.5" />
          </svg>
        </div>
        <p className="text-[13px] text-[var(--m03-fg-3)]">No AI activity yet</p>
        <p className="mt-1 text-[11px] text-[var(--m03-fg-3)]">
          AI insights will appear once the agent processes this conversation.
        </p>
      </div>
    );
  }

  // Early return: loading → spinner.
  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 py-4 text-[13px] text-[var(--m03-fg-2)]"
        role="status"
        aria-label="Loading insights"
      >
        <Spinner />
        Loading insights…
      </div>
    );
  }

  const confidencePercent = decision ? Math.round(decision.confidence * 100) : null;

  return (
    <div className="space-y-4">
      {/* 1. Status + Confidence */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon aiState={aiState} />
          <span className={`text-[13px] font-medium ${STATUS_COLOR[aiState]}`}>
            {STATUS_LABEL[aiState]}
          </span>
        </div>
        {confidencePercent !== null && (
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${getConfidenceClass(confidencePercent)}`}
          >
            {confidencePercent}%
          </span>
        )}
      </div>

      {/* 2. Decision type */}
      {decision?.decision_type && (
        <div>
          <h4 className="mb-1 text-[11px] text-[var(--m03-fg-2)]">Decision</h4>
          <span className="inline-flex items-center rounded border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--m03-fg-2)] capitalize">
            {decision.decision_type.replace(/_/g, ' ')}
          </span>
        </div>
      )}

      {/* 3. Reasoning */}
      {decision?.reasoning_summary && (
        <div>
          <h4 className="mb-1.5 text-[11px] text-[var(--m03-fg-2)]">Reasoning</h4>
          <div className="rounded border border-[var(--m03-line)] bg-[var(--m03-line-2)] p-3 text-[13px] text-[var(--m03-fg)]">
            <p>{decision.reasoning_summary}</p>
          </div>
        </div>
      )}

      {/* 4. Tags */}
      {decision?.tags && decision.tags.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] text-[var(--m03-fg-2)]">Tags</h4>
          <div className="flex flex-wrap gap-1.5">
            {decision.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded border border-[var(--m03-orange-line)] bg-[var(--m03-orange-fill)] px-2 py-0.5 text-[11px] text-[var(--m03-orange)]"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 5. Sources — derived from raw_response, fallback to "Knowledge Base" */}
      {decision && (
        <div>
          <h4 className="mb-1.5 text-[11px] text-[var(--m03-fg-2)]">Sources</h4>
          <div className="flex flex-wrap gap-1.5">
            {Array.isArray(decision.raw_response?.sources) ? (
              (decision.raw_response.sources as string[]).map((src) => (
                <span
                  key={src}
                  className="inline-flex items-center rounded border border-[var(--m03-line)] bg-white px-2 py-0.5 text-[11px] text-[var(--m03-fg-2)]"
                >
                  {src}
                </span>
              ))
            ) : (
              <span className="inline-flex items-center rounded border border-[var(--m03-line)] bg-white px-2 py-0.5 text-[11px] text-[var(--m03-fg-2)]">
                Knowledge Base
              </span>
            )}
          </div>
        </div>
      )}

      {/* 6. Response Time */}
      {decision?.created_at && (
        <div>
          <h4 className="mb-1 text-[11px] text-[var(--m03-fg-2)]">Response Time</h4>
          <p className="font-mono text-[13px] text-[var(--m03-fg-2)]">
            {formatResponseTime(decision.created_at, conversation.last_message_at)}
          </p>
        </div>
      )}

      {/* 7. requires_human warning */}
      {decision?.requires_human && (
        <div
          className="flex items-center gap-2 rounded border border-[var(--m03-orange-line)] bg-[var(--m03-orange-fill)] p-3 text-[13px] text-[var(--m03-orange)]"
          role="alert"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
            aria-hidden="true"
          >
            <path d="M7 5v3M7 10h.01" />
            <circle cx="7" cy="7" r="6" />
          </svg>
          <span className="font-medium">Human review recommended</span>
        </div>
      )}

      {/* 8. Suggested Actions — visual only, no onClick */}
      {decision?.tags && decision.tags.length > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] text-[var(--m03-fg-2)]">Suggested Actions</h4>
          <div className="space-y-2">
            {decision.tags.slice(0, 3).map((tag) => (
              <button
                key={tag}
                type="button"
                className="flex w-full items-center justify-between rounded border border-[var(--m03-line)] bg-white p-2 text-[13px] text-[var(--m03-fg-2)] transition-colors hover:bg-[var(--m03-line-2)]"
              >
                <span>Apply &apos;{tag}&apos; tag</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[var(--m03-fg-3)]"
                  aria-hidden="true"
                >
                  <circle cx="7" cy="7" r="5" />
                  <path d="M7 5v4M5 7h4" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
