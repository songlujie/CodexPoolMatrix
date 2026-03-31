import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Sun, Moon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

interface HeaderProps {
  activeAccount: string;
  mode: 'codex' | 'trae';
  onModeChange: (mode: 'codex' | 'trae') => void;
}

const LANG_FLAG: Record<string, { flag: string; label: string }> = {
  zh: { flag: '🇨🇳', label: 'CN' },
  en: { flag: '🇺🇸', label: 'EN' },
};

export function Header({ activeAccount, mode, onModeChange }: HeaderProps) {
  const [time, setTime] = useState(new Date());
  const { lang, setLang, t } = useI18n();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const currentLang = LANG_FLAG[lang];
  const nextLang = lang === 'zh' ? 'en' : 'zh';

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-border/50 bg-card/50 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">{t('app.title')}</h1>
        <span className="text-xs text-muted-foreground">{t('app.version')}</span>
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

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>

        {/* Language toggle — shows current lang flag + code */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => setLang(nextLang)}
          title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
        >
          <span
            className="text-base leading-none"
            style={{ display: 'inline-block', width: '1.2em', textAlign: 'center' }}
          >
            {currentLang.flag}
          </span>
          <span>{currentLang.label}</span>
        </Button>

        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {time.toLocaleTimeString('en-US', { hour12: false })}
        </span>
      </div>
    </header>
  );
}
