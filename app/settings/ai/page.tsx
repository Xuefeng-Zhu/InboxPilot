'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { insforge } from '@/lib/insforge';

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AiSettingsPage() {
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
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await insforge.from<AiSettings>('ai_settings', {
        limit: 1,
        single: true,
      });
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      if (data && !Array.isArray(data)) {
        setSettings(data);
        setAiMode(data.ai_mode);
        setConfidenceThreshold(data.confidence_threshold);
        setContextWindowSize(data.context_window_size);
        setEscalationKeywords(data.escalation_keywords ?? []);
        setSystemPrompt(data.system_prompt ?? '');
        setModel(data.model);
      }
    } catch {
      setError('Failed to load AI settings');
    } finally {
      setLoading(false);
    }
  }, []);

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
      const { error: updateError } = await insforge.update(
        'ai_settings',
        {
          ai_mode: aiMode,
          confidence_threshold: confidenceThreshold,
          context_window_size: contextWindowSize,
          escalation_keywords: escalationKeywords,
          system_prompt: systemPrompt || null,
          model,
          updated_at: new Date().toISOString(),
        },
        { id: `eq.${settings.id}` },
      );
      if (updateError) {
        setError(updateError.message);
        return;
      }

      // Record audit log entry for settings change
      await insforge.insert('audit_logs', {
        organization_id: settings.organization_id,
        actor_id: user?.id ?? null,
        actor_type: 'user',
        action: 'settings_changed',
        resource_type: 'ai_settings',
        resource_id: settings.id,
        metadata: { ai_mode: aiMode, model },
      });

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

  // Loading state
  if (authLoading || loading) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-gray-900">AI Settings</h1>
          <p className="mt-4 text-sm text-gray-500">Loading settings…</p>
        </div>
      </main>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-gray-900">AI Settings</h1>
          <p className="mt-4 text-sm text-red-600">Please sign in to manage AI settings.</p>
        </div>
      </main>
    );
  }

  // No settings found
  if (!settings) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-gray-900">AI Settings</h1>
          <p className="mt-4 text-sm text-gray-500">
            No AI settings found for your organization. Please create an organization first.
          </p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">AI Settings</h1>
        <p className="mt-1 text-sm text-gray-600">
          Configure AI mode, confidence threshold, and escalation rules.
        </p>

        {/* Status messages */}
        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {success && (
          <div className="mt-4 rounded-md bg-green-50 p-3" role="status">
            <p className="text-sm text-green-700">{success}</p>
          </div>
        )}

        <form
          className="mt-6 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          {/* AI Mode */}
          <fieldset>
            <legend className="text-sm font-medium text-gray-900">AI Mode</legend>
            <p className="mt-1 text-xs text-gray-500">Choose how the AI handles inbound messages.</p>
            <div className="mt-3 space-y-2">
              {AI_MODE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start rounded-md border p-3 ${
                    aiMode === option.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="ai_mode"
                    value={option.value}
                    checked={aiMode === option.value}
                    onChange={() => setAiMode(option.value)}
                    className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-3">
                    <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                    <span className="block text-xs text-gray-500">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Confidence Threshold */}
          <div>
            <label htmlFor="confidence-threshold" className="block text-sm font-medium text-gray-900">
              Confidence Threshold
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Minimum confidence score for auto-replies (0.0 – 1.0). Current: {confidenceThreshold.toFixed(2)}
            </p>
            <input
              id="confidence-threshold"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
              className="mt-2 w-full accent-blue-600"
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={confidenceThreshold}
            />
            <div className="mt-1 flex justify-between text-xs text-gray-400">
              <span>0.00</span>
              <span>0.50</span>
              <span>1.00</span>
            </div>
          </div>

          {/* Context Window Size */}
          <div>
            <label htmlFor="context-window-size" className="block text-sm font-medium text-gray-900">
              Context Window Size
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Number of recent messages to include in AI context.
            </p>
            <input
              id="context-window-size"
              type="number"
              min="1"
              max="100"
              value={contextWindowSize}
              onChange={(e) => setContextWindowSize(parseInt(e.target.value, 10) || 1)}
              className="mt-2 block w-32 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Model Selection */}
          <div>
            <label htmlFor="model-select" className="block text-sm font-medium text-gray-900">
              AI Model
            </label>
            <p className="mt-1 text-xs text-gray-500">Select the LLM model for AI responses.</p>
            <select
              id="model-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* System Prompt */}
          <div>
            <label htmlFor="system-prompt" className="block text-sm font-medium text-gray-900">
              System Prompt
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Custom instructions for the AI agent. Leave blank for default behavior.
            </p>
            <textarea
              id="system-prompt"
              rows={4}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful customer support agent…"
              className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Escalation Keywords */}
          <div>
            <label htmlFor="keyword-input" className="block text-sm font-medium text-gray-900">
              Escalation Keywords
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Messages containing these keywords will be escalated to a human agent.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                id="keyword-input"
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={handleKeywordKeyDown}
                placeholder="Type a keyword and press Enter"
                className="block flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={addKeyword}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
              >
                Add
              </button>
            </div>
            {escalationKeywords.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2" role="list" aria-label="Escalation keywords">
                {escalationKeywords.map((kw) => (
                  <span
                    key={kw}
                    role="listitem"
                    className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800"
                  >
                    {kw}
                    <button
                      type="button"
                      onClick={() => removeKeyword(kw)}
                      className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-blue-600 hover:bg-blue-200 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      aria-label={`Remove keyword ${kw}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-3 border-t border-gray-200 pt-6">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
