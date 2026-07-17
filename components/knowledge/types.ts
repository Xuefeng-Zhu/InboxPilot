export interface KnowledgeDocument {
  id: string;
  organization_id: string;
  title: string;
  source_type: string;
  body: string;
  content_revision?: string | null;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  error_message: string | null;
  file_url: string | null;
  file_name: string | null;
  file_key: string | null;
  created_at: string;
  updated_at: string;
}

export const SOURCE_TYPES = ['faq', 'article', 'policy', 'manual', 'product_info', 'other'] as const;

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

export function getStatusTooltip(status: KnowledgeDocument['status']): string {
  switch (status) {
    case 'pending':
      return 'Waiting to be processed. AI cannot use this document yet.';
    case 'processing':
      return 'Being chunked and embedded. Will be available to AI shortly.';
    case 'ready':
      return 'Processed and available. AI uses this document to answer questions.';
    case 'failed':
      return 'Processing failed. AI cannot use this document. Check the error for details.';
    default:
      return '';
  }
}
