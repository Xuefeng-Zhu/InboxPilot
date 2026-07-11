'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { insforge } from '@/lib/insforge';
import { Card, Button, Select, cn } from '@/components/ui';
import {
  CHAT_MODEL_OPTIONS,
  EMBEDDING_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
} from '@support-core/types';
import type { ModelId, EmbeddingModelId } from '@support-core/types';
import { useCurrentMembership } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AiSettings {
  id: string;
  organization_id: string;
  ai_mode: 'off' | 'draft_only' | 'auto_reply';
  confidence_threshold: number;
  context_window_size: number;
  max_consecutive_failures: number;
  knowledge_similarity_threshold: number;
  escalation_keywords: string[];
  system_prompt: string | null;
  model: string;
  embedding_model: EmbeddingModelId;
  created_at: string;
  updated_at: string;
}

const AI_MODE_OPTIONS: { value: AiSettings['ai_mode']; label: string; description: string }[] = [
  { value: 'off', label: 'Off', description: 'AI processing is disabled' },
  { value: 'draft_only', label: 'Draft Only', description: 'AI drafts responses for human review' },
  { value: 'auto_reply', label: 'Auto Reply', description: 'AI sends responses automatically when confident' },
];

function applySettingsToForm(
  settings: AiSettings,
  setters: {
    setSettings: (settings: AiSettings) => void;
    setAiMode: (mode: AiSettings['ai_mode']) => void;
    setConfidenceThreshold: (threshold: number) => void;
    setContextWindowSize: (size: number) => void;
    setEscalationKeywords: (keywords: string[]) => void;
    setSystemPrompt: (prompt: string) => void;
    setModel: (model: ModelId) => void;
    setEmbeddingModel: (model: EmbeddingModelId) => void;
  },
) {
  setters.setSettings(settings);
  setters.setAiMode(settings.ai_mode);
  setters.setConfidenceThreshold(Number(settings.confidence_threshold));
  setters.setContextWindowSize(settings.context_window_size);
  setters.setEscalationKeywords(settings.escalation_keywords ?? []);
  setters.setSystemPrompt(settings.system_prompt ?? '');
  setters.setModel(settings.model as ModelId);
  setters.setEmbeddingModel(settings.embedding_model);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AiSettingsPanel() {
  const { user, loading: authLoading } = useAuth();
  const { data: membership, isLoading: membershipLoading } = useCurrentMembership(user?.id);
  const canManage = membership?.role === 'owner' || membership?.role === 'admin';

  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [aiMode, setAiMode] = useState<AiSettings['ai_mode']>('draft_only');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.75);
  const [contextWindowSize, setContextWindowSize] = useState(20);
  const [escalationKeywords, setEscalationKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState<ModelId>(DEFAULT_CHAT_MODEL);
  const [embeddingModel, setEmbeddingModel] = useState<EmbeddingModelId>(DEFAULT_EMBEDDING_MODEL);

  const fetchSettings = useCallback(async () => {
    if (!user || !membership) return;

    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await insforge.database
        .from('ai_settings')
        .select()
        .eq('organization_id', membership.organizationId)
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      if (data && !Array.isArray(data)) {
        applySettingsToForm(data as AiSettings, {
          setSettings,
          setAiMode,
          setConfidenceThreshold,
          setContextWindowSize,
          setEscalationKeywords,
          setSystemPrompt,
          setModel,
          setEmbeddingModel,
        });
        return;
      }

      if (!canManage) {
        setError('No AI settings are configured. An owner or admin can create them.');
        return;
      }

      const organizationId = membership.organizationId;
      const { data: createdSettings, error: createError } = await insforge.database
        .from('ai_settings')
        .insert([{ organization_id: organizationId }])
        .select()
        .single();

      if (createError) {
        setError(createError.message);
        return;
      }

      if (createdSettings && !Array.isArray(createdSettings)) {
        const s = createdSettings as AiSettings;
        applySettingsToForm(s, {
          setSettings,
          setAiMode,
          setConfidenceThreshold,
          setContextWindowSize,
          setEscalationKeywords,
          setSystemPrompt,
          setModel,
          setEmbeddingModel,
        });

        await insforge.database
          .from('audit_logs')
          .insert([{
            organization_id: organizationId,
            actor_id: user.id,
            actor_type: 'user',
            action: 'settings_created',
            resource_type: 'ai_settings',
            resource_id: s.id,
            metadata: { source: 'settings_page_default' },
          }])
          .select();
      }
    } catch {
      setError('Failed to load AI settings');
    } finally {
      setLoading(false);
    }
  }, [canManage, membership, user]);

  useEffect(() => {
    if (!authLoading && !membershipLoading && user && membership) {
      void fetchSettings();
    } else if (!authLoading && !membershipLoading) {
      setLoading(false);
    }
  }, [authLoading, membership, membershipLoading, user, fetchSettings]);

  const handleSave = async () => {
    if (!settings || !canManage) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: updateError } = await insforge.database
        .from('ai_settings')
        .update({
          ai_mode: aiMode,
          confidence_threshold: confidenceThreshold,
          context_window_size: contextWindowSize,
          escalation_keywords: escalationKeywords,
          system_prompt: systemPrompt || null,
          model,
          embedding_model: embeddingModel,
          updated_at: new Date().toISOString(),
        })
        .eq('id', settings.id)
        .select();

      if (updateError) {
        setError(updateError.message);
        return;
      }

      await insforge.database
        .from('audit_logs')
        .insert([{
          organization_id: settings.organization_id,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'settings_changed',
          resource_type: 'ai_settings',
          resource_id: settings.id,
          metadata: { ai_mode: aiMode, model, embedding_model: embeddingModel },
        }])
        .select();

      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const addKeyword = () => {
    const trimmed = keywordInput.trim().toLowerCase();
    if (trimmed && !escalationKeywords.includes(trimmed)) {
      setEscalationKeywords((prev) => [...prev, trimmed]);
    }
    setKeywordInput('');
  };

  const removeKeyword = (keyword: string) => {
    setEscalationKeywords((prev) => prev.filter((k) => k !== keyword));
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  if (authLoading || membershipLoading || loading) {
    return <p className="text-[14px] text-[var(--m03-fg-2)]">Loading settings…</p>;
  }

  if (!user) {
    return <p className="text-[14px] text-[var(--m03-red)]">Please sign in to manage AI settings.</p>;
  }

  if (!settings) {
    return (
      <div>
        <p className="text-[14px] text-[var(--m03-fg-2)]">
          No AI settings found for your organization.
        </p>
        {error && <p className="mt-2 text-[14px] text-[var(--m03-red)]">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3" role="alert">
          <p className="text-[14px] text-[var(--m03-red)]">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-4 rounded border border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] p-3" role="status">
          <p className="text-[14px] text-[var(--m03-green)]">{success}</p>
        </div>
      )}

      {!canManage && (
        <div className="mb-4 rounded border border-[var(--m03-line)] bg-[var(--m03-line-2)] p-3 text-[13px] text-[var(--m03-fg-2)]">
          These settings are read-only. An owner or admin can change AI behavior.
        </div>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <fieldset disabled={!canManage} className="contents">
        {/* AI Mode Card */}
        <Card
          header={
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">AI Mode</h2>
              <p className="mt-1 text-[13px] text-[var(--m03-fg-2)]">Choose how the AI handles inbound messages.</p>
            </div>
          }
        >
          <div className="flex flex-col gap-2">
            {AI_MODE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start rounded-md border p-3 transition-colors ${
                  aiMode === option.value
                    ? 'border-[var(--m03-fg)] bg-[var(--m03-line-2)]'
                    : 'border-[var(--m03-line)] hover:bg-[var(--m03-line-2)]'
                }`}
              >
                <input
                  type="radio"
                  name="ai_mode"
                  value={option.value}
                  checked={aiMode === option.value}
                  onChange={() => setAiMode(option.value)}
                  className="mt-0.5 h-4 w-4 accent-[var(--m03-fg)] focus:ring-[var(--m03-fg)]"
                />
                <span className="ml-3">
                  <span className="block text-[14px] font-medium text-[var(--m03-fg)]">{option.label}</span>
                  <span
                    className={cn(
                      'block text-[12px]',
                      aiMode === option.value
                        ? 'text-[var(--m03-fg)]'
                        : 'text-[var(--m03-fg-2)]',
                    )}
                  >
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        {/* Model Selection Card */}
        <Card
          header={
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">Model Selection</h2>
              <p className="mt-1 text-[13px] text-[var(--m03-fg-2)]">Select the LLM model for AI responses.</p>
            </div>
          }
        >
          <Select
            id="model-select"
            value={model}
            onValueChange={(v) => setModel(v as ModelId)}
            options={CHAT_MODEL_OPTIONS.map((m) => ({ value: m, label: m }))}
          />
        </Card>

        {/* Embedding Model Card */}
        <Card
          header={
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">Embedding Model</h2>
              <p className="mt-1 text-[13px] text-[var(--m03-fg-2)]">Used for knowledge-base similarity search.</p>
            </div>
          }
        >
          <div className="space-y-2">
            <Select
              id="embedding-model-select"
              value={embeddingModel}
              onValueChange={(v) => setEmbeddingModel(v as EmbeddingModelId)}
              options={EMBEDDING_MODEL_OPTIONS.map((m) => ({ value: m, label: m }))}
            />
            <p className="text-[12px] text-[var(--m03-fg-2)]">
              Changing this requires re-indexing your knowledge base. Until then, similarity scores may degrade.
            </p>
          </div>
        </Card>

        {/* Confidence Threshold Card */}
        <Card
          header={
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">Confidence Threshold</h2>
              <p className="mt-1 text-[13px] text-[var(--m03-fg-2)]">
                Minimum confidence score for auto-replies (0.0 – 1.0). Current:{' '}
                <span className="font-medium tabular-nums text-[var(--m03-fg)]">{confidenceThreshold.toFixed(2)}</span>
              </p>
            </div>
          }
        >
          <input
            id="confidence-threshold"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={confidenceThreshold}
            onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
            className="w-full accent-[var(--m03-fg)]"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={confidenceThreshold}
            aria-label="Confidence threshold"
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--m03-fg-3)]">
            <span>0.00</span>
            <span>0.50</span>
            <span>1.00</span>
          </div>
        </Card>

        {/* Context Window Card */}
        <Card
          header={
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">Context Window</h2>
              <p className="mt-1 text-[13px] text-[var(--m03-fg-2)]">
                Number of recent messages to include in AI context.
              </p>
            </div>
          }
        >
          <input
            id="context-window-size"
            type="number"
            min="1"
            max="100"
            value={contextWindowSize}
            onChange={(e) => setContextWindowSize(parseInt(e.target.value, 10) || 1)}
            className="block w-32 rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[14px] text-[var(--m03-fg)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
            aria-label="Context window size"
          />
        </Card>

        {/* System Prompt Card */}
        <Card
          header={
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">System Prompt</h2>
              <p className="mt-1 text-[13px] text-[var(--m03-fg-2)]">
                Custom instructions for the AI agent. Leave blank for default behavior.
              </p>
            </div>
          }
        >
          <textarea
            id="system-prompt"
            rows={4}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful customer support agent…"
            className="block w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[14px] text-[var(--m03-fg)] placeholder:text-[var(--m03-fg-3)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
          />
        </Card>

        {/* Escalation Keywords Card */}
        <Card
          header={
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">Escalation Keywords</h2>
              <p className="mt-1 text-[13px] text-[var(--m03-fg-2)]">
                Messages containing these keywords will be escalated to a human agent.
              </p>
            </div>
          }
        >
          <div className="flex gap-2">
            <input
              id="keyword-input"
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={handleKeywordKeyDown}
              placeholder="Type a keyword and press Enter"
              className="block flex-1 rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[14px] text-[var(--m03-fg)] placeholder:text-[var(--m03-fg-3)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
            />
            <Button type="button" variant="secondary" size="md" onClick={addKeyword}>
              Add
            </Button>
          </div>
          {escalationKeywords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" role="list" aria-label="Escalation keywords">
              {escalationKeywords.map((kw) => (
                <span
                  key={kw}
                  role="listitem"
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--m03-fg)]"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw)}
                    className="ml-1 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded text-[var(--m03-fg-2)] hover:bg-[var(--m03-line)] hover:text-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
                    aria-label={`Remove keyword ${kw}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Save Button */}
        <div className="flex items-center gap-3 border-t border-[var(--m03-line)] pt-4">
          <Button type="submit" variant="primary" size="md" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
        </fieldset>
      </form>
    </div>
  );
}
