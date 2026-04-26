import type { Account } from '@/types';

export const statusBorderClass: Record<Account['status'], string> = {
  active: 'status-border-active',
  idle: 'status-border-idle',
  error: 'status-border-error',
  rate_limited: 'status-border-warning',
  cooldown: 'status-border-cooldown',
};

export const statusBadge: Record<Account['status'], { label: string; className: string }> = {
  active: { label: 'ACTIVE', className: 'bg-primary/15 text-primary border-primary/30' },
  idle: { label: 'IDLE', className: 'bg-muted/30 text-muted-foreground border-muted/50' },
  error: { label: 'ERROR', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  rate_limited: { label: 'RATE LIMITED', className: 'bg-warning/15 text-warning border-warning/30' },
  cooldown: { label: 'COOLDOWN', className: 'bg-info/15 text-info border-info/30' },
};

export const oauthTypeBadge: Record<Account['auth_type'], { label: string; className: string }> = {
  team: { label: 'TEAM', className: 'bg-info/15 text-info border-info/30' },
  plus: { label: 'PLUS', className: 'bg-primary/15 text-primary border-primary/30' },
  free: { label: 'FREE', className: 'bg-muted/30 text-muted-foreground border-muted/50' },
};

export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;
  const [local, rest] = email.split('@');
  if (!rest) return email;
  const dotIdx = rest.indexOf('.');
  const domain = dotIdx >= 0 ? rest.slice(0, dotIdx) : rest;
  const tld = dotIdx >= 0 ? rest.slice(dotIdx) : '';
  const maskedLocal = local.length > 2 ? `${local.slice(0, 2)}***` : local;
  const maskedDomain = domain.length > 2 ? `${domain.slice(0, 2)}***` : domain;
  return `${maskedLocal}@${maskedDomain}${tld}`;
}

export function barColor(pct: number) {
  if (pct >= 80) return 'bg-destructive';
  if (pct >= 50) return 'bg-warning';
  return 'bg-primary';
}
