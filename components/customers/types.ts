export interface Contact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

// Avatar palette uses m03 design tokens only (no purple/ai/blue legacy classes).
// Each entry pairs a tinted background with a foreground that meets contrast on it.
export const AVATAR_COLORS = [
  'bg-[var(--m03-line-2)] text-[var(--m03-fg)]',
  'bg-[#e6f4ec] text-[var(--m03-green)]',
  'bg-[#fce8d4] text-[#a55a00]',
  'bg-[#fde2e2] text-[var(--m03-red)]',
  'bg-[var(--m03-line-2)] text-[var(--m03-fg-2)]',
];

export function getAvatarColor(id: string): string {
  const hash = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function getInitials(name: string | null, email: string | null): string {
  if (name) {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }
  if (email) {
    return email[0].toUpperCase();
  }
  return '?';
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}
