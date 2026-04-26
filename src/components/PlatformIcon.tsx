/**
 * Official platform SVG logos — embedded as inline SVG paths.
 * No external dependencies needed.
 */

interface PlatformIconProps {
  platform: string;
  className?: string;
  size?: number;
}

// OpenAI logo — the 6-petal gear/flower shape
function OpenAIIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-label="OpenAI">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.843-3.369 2.02-1.168a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.402-.681zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.41 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

// Google Gemini logo — the 4-point diamond/sparkle shape
function GeminiIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label="Gemini">
      <defs>
        <linearGradient id="gemini-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="50%" stopColor="#9B72CB" />
          <stop offset="100%" stopColor="#EA4335" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gemini-grad)"
        d="M12 1.5C7.31 7.08 6.04 8.35.5 12c5.54 3.65 6.81 4.92 11.5 10.5 4.69-5.58 5.96-6.85 11.5-10.5C17.96 8.35 16.69 7.08 12 1.5z"
      />
    </svg>
  );
}

// Anthropic Claude logo — sunburst / radial lines circle
function ClaudeIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label="Claude">
      <defs>
        <linearGradient id="claude-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D97706" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      {/* Radial dots arranged in a circle — Claude's signature sunburst */}
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const r = 8.5;
        const cx = 12 + r * Math.cos(angle - Math.PI / 2);
        const cy = 12 + r * Math.sin(angle - Math.PI / 2);
        const opacity = 0.4 + (i % 3) * 0.2;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={1.1}
            fill="url(#claude-grad)"
            opacity={opacity}
          />
        );
      })}
      {/* Inner circle */}
      <circle cx="12" cy="12" r="2.5" fill="url(#claude-grad)" opacity="0.9" />
    </svg>
  );
}

// Generic platform icon — first letter in a colored circle
function GenericIcon({ platform, size = 16, className = '' }: { platform: string; size?: number; className?: string }) {
  const letter = platform.charAt(0).toUpperCase();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label={platform}>
      <circle cx="12" cy="12" r="11" fill="hsl(var(--muted))" />
      <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="600" fill="hsl(var(--foreground))">{letter}</text>
    </svg>
  );
}

export function PlatformIcon({ platform, size = 16, className = '' }: PlatformIconProps) {
  const p = (platform || 'gpt').toLowerCase();
  if (p === 'gpt' || p === 'openai') return <OpenAIIcon size={size} className={className} />;
  if (p === 'gemini') return <GeminiIcon size={size} className={className} />;
  if (p === 'claude') return <ClaudeIcon size={size} className={className} />;
  return <GenericIcon platform={platform} size={size} className={className} />;
}

/** Platform accent color for text/border styling */
export function platformColor(platform: string): string {
  const p = (platform || 'gpt').toLowerCase();
  if (p === 'gpt' || p === 'openai') return 'text-foreground';
  if (p === 'gemini') return 'text-blue-400';
  if (p === 'claude') return 'text-amber-500';
  return 'text-muted-foreground';
}
