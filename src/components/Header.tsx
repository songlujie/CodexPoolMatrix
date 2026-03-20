import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface HeaderProps {
  activeAccount: string;
  mode: 'codex' | 'trae';
  onModeChange: (mode: 'codex' | 'trae') => void;
}

export function Header({ activeAccount, mode, onModeChange }: HeaderProps) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-border/50 bg-card/50 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">Codex Pool Manager</h1>
        <span className="text-xs text-muted-foreground">v1.0</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse-dot" />
          <span className="font-medium text-foreground">{activeAccount}</span>
        </div>

        <Select value={mode} onValueChange={(v) => onModeChange(v as 'codex' | 'trae')}>
          <SelectTrigger className="h-7 w-24 text-xs bg-secondary border-border/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="codex">Codex</SelectItem>
            <SelectItem value="trae">Trae</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {time.toLocaleTimeString('en-US', { hour12: false })}
        </span>
      </div>
    </header>
  );
}
