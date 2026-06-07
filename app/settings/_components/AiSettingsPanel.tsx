'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { insforge } from '@/lib/insforge';
import { Card, Button } from '@/components/ui';

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
  created_at: string;
  updated_at: string;
}

const AI_MODE_OPTIONS: { value: AiSettings['ai_mode']; label: string; description: string }[] = [
  { value: 'off', label: 'Off', description: 'AI processing is disabled' },
  { value: 'draft_only', label: 'Draft Only', description: 'AI drafts responses for human review' },
  { value: 'auto_reply', label: 'Auto Reply', description: 'AI sends responses automatically when confident' },
];

const MODEL_OPTIONS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'openai/gpt-3.5-turbo',
  'anthropic/claude-3-haiku',
  'anthropic/claude-3-sonnet',
  'anthropic/claude-3-opus',
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
    setModel: (model: string) => void;
  },
) {
  setters.setSettings(settings);
  setters.setAiMode(settings.ai_mode);
  setters.setConfidenceThreshold(Number(settings.confidence_threshold));
  setters.setContextWindowSize(settings.context_window_size);
  setters.setEscalationKeywords(settings.escalation_keywords ?? []);
  setters.setSystemPrompt(settings.system_prompt ?? '');
  setters.setModel(settings.model);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AiSettingsPanel() {
  const { user, loading: authLoading } = useAuth();

  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [aiMode, setAiMode] = useState<AiSettings['ai_mode']>('draft_only');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.75);
  const [contextWindowSize, setContextWindowSize] = useState(20);
  const [escalationKeywords, setEscalationKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('openai/gpt-4o-mini');

  // Fetch AI settings
  const fetchSettings = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await insforge.database
        .from('ai_settings')
        .select()
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
        });
        return;
      }

      const { data: member, error: memberError } = await insforge.database
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (memberError || !member || Array.isArray(member)) {
        setError(memberError?.message ?? 'No organization found for this account.');
        return;
      }

      const organizationId = (member as { organization_id: string }).organization_id;
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
  }, [user]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchSettings();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [authLoading, user, fetchSettings]);

  // Save settings
  const handleSave = async () => {
    if (!settings) return;
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
          updated_at: new Date().toISOString(),
        })
        .eq('id', settings.id)
        .select();

      if (updateError) {
        setError(updateError.message);
        return;
      }

      // Record audit log entry for settings change
      await insforge.database
        .from('audit_logs')
        .insert([{
          organization_id: settings.organization_id,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'settings_changed',
          resource_type: 'ai_settings',
          resource_id: settings.id,
          metadata: { ai_mode: aiMode, model },
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

  // Keyword management
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

  if (authLoading || loading) {
    return <p className="text-body-md text-gray-500">Loading settings…</p>;
  }

  if (!user) {
    return <p className="text-body-md text-red-600">Please sign in to manage AI settings.</p>;
  }

  if (!settings) {
    return (
      <div>
        <p className="text-body-md text-gray-500">
          No AI settings found for your organization. Please create an organization first.
        </p>
        {error && <p className="mt-2 text-body-md text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {/* Status messages */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3" role="alert">
          <p className="text-body-md text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3" role="status">
          <p className="text-body-md text-green-700">{success}</p>
        </div>
      )}

      <form
        className="space-y-element-gap"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        {/* AI Mode Card */}
        <Card
          header={
            <div>
              <h2 className="text-headline-sm text-gray-900">AI Mode</h2>
              <p className="mt-1 text-body-md text-gray-500">Choose how the AI handles inbound messages.</p>
            </div>
          }
          className="border-ai-200"
        >
          <div className="space-y-2">
            {AI_MODE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start rounded-md border p-3 transition-colors ${
                  aiMode === option.value
                    ? 'border-ai-200 bg-ai-50'
                    : 'border-surface-border hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="ai_mode"
                  value={option.value}
                  checked={aiMode === option.value}
                  onChange={() => setAiMode(option.value)}
                  className="mt-0.5 h-4 w-4 text-ai-700 focus:ring-ai-500"
                />
                <span className="ml-3">
                  <span className="block text-body-md font-medium text-gray-900">{option.label}</span>
                  <span className="block text-body-sm text-gray-500">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        {/* Model Selection Card */}
        <Card
          header={
            <div>
              <h2 className="text-headline-sm text-gray-900">Model Selection</h2>
              <p className="mt-1 text-body-md text-gray-500">Select the LLM model for AI responses.</p>
            </div>
          }
          className="border-ai-200"
        >
          <select
            id="model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="block w-full rounded border border-ai-200 bg-ai-50 px-3 py-2 text-body-md text-ai-700 focus:border-ai-500 focus:outline-none focus:ring-2 focus:ring-ai-200 focus:ring-offset-1"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Card>

        {/* Confidence Threshold Card */}
        <Card
          header={
            <div>
              <h2 className="text-headline-sm text-gray-900">Confidence Threshold</h2>
              <p className="mt-1 text-body-md text-gray-500">
                Minimum confidence score for auto-replies (0.0 – 1.0). Current:{' '}
                <span className="font-medium text-ai-700">{confidenceThreshold.toFixed(2)}</span>
              </p>
            </div>
          }
          className="border-ai-200"
        >
          <input
            id="confidence-threshold"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={confidenceThreshold}
            onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
            className="w-full accent-ai-500"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={confidenceThreshold}
            aria-label="Confidence threshold"
          />
          <div className="mt-1 flex justify-between text-label-sm text-gray-400">
            <span>0.00</span>
            <span>0.50</span>
            <span>1.00</span>
          </div>
        </Card>

        {/* Context Window Card */}
        <Card
          header={
            <div>
              <h2 className="text-headline-sm text-gray-900">Context Window</h2>
              <p className="mt-1 text-body-md text-gray-500">
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
            className="block w-32 rounded border border-gray-300 px-3 py-2 text-body-md focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-1"
            aria-label="Context window size"
          />
        </Card>

        {/* System Prompt Card */}
        <Card
          header={
            <div>
              <h2 className="text-headline-sm text-gray-900">System Prompt</h2>
              <p className="mt-1 text-body-md text-gray-500">
                Custom instructions for the AI agent. Leave blank for default behavior.
              </p>
            </div>
          }
          className="border-ai-200"
        >
          <textarea
            id="system-prompt"
            rows={4}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful customer support agent…"
            className="block w-full rounded border border-ai-200 bg-ai-50 px-3 py-2 text-body-md text-ai-700 placeholder:text-ai-700/40 focus:border-ai-500 focus:outline-none focus:ring-2 focus:ring-ai-200 focus:ring-offset-1"
          />
        </Card>

        {/* Escalation Keywords Card */}
        <Card
          header={
            <div>
              <h2 className="text-headline-sm text-gray-900">Escalation Keywords</h2>
              <p className="mt-1 text-body-md text-gray-500">
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
              className="block flex-1 rounded border border-gray-300 px-3 py-2 text-body-md placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-1"
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
                  className="inline-flex items-center gap-1 rounded-full bg-ai-50 border border-ai-200 px-3 py-1 text-xs font-medium text-ai-700"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw)}
                    className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-ai-700 hover:bg-ai-200 hover:text-ai-900 focus:outline-none focus:ring-2 focus:ring-ai-500"
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
        <div className="flex items-center gap-3 border-t border-surface-border pt-6">
          <Button type="submit" variant="primary" size="md" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
