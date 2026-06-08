export interface KnowledgeDocument {
  id: string;
  organization_id: string;
  title: string;
  source_type: string;
  body: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  error_message: string | null;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
  updated_at: string;
}

export const SOURCE_TYPES = ['faq', 'article', 'policy', 'manual', 'other'] as const;

export const ACCEPTED_FILE_TYPES = '.pdf,.txt,.md,.docx,.csv';
export const MAX_FILE_SIZE_MB = 10;

export function mapStatusToBadge(
  status: KnowledgeDocument['status'],
): 'open' | 'resolved' | 'ai_draft' | 'escalated' {
  switch (status) {
    case 'ready':
      return 'resolved';
    case 'processing':
      return 'ai_draft';
    case 'pending':
      return 'open';
    case 'failed':
      return 'escalated';
    default:
      return 'open';
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
