import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Check, Moon, Palette, Sparkles, Sun } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

interface HeaderProps {
  activeAccount: string;
  mode: 'codex' | 'claude';
  onModeChange: (mode: 'codex' | 'claude') => void;
}

const LANG_FLAG: Record<string, { flag: string; label: string }> = {
  zh: { flag: '🇨🇳', label: 'CN' },
  en: { flag: '🇺🇸', label: 'EN' },
};

const THEME_SWATCHES = [
  {
    id: 'violet',
    label: 'Violet',
    hint: '现代紫罗兰',
    preview: 'linear-gradient(135deg, hsl(268 82% 66%), hsl(292 82% 62%))',
  },
  {
    id: 'blue',
    label: 'Blue',
    hint: '清爽科技蓝',
    preview: 'linear-gradient(135deg, hsl(221 83% 62%), hsl(203 89% 60%))',
  },
  {
    id: 'emerald',
    label: 'Emerald',
    hint: 'Notion 风绿色',
    preview: 'linear-gradient(135deg, hsl(160 84% 42%), hsl(174 72% 45%))',
  },
  {
    id: 'amber',
    label: 'Amber',
    hint: '线性暖金色',
    preview: 'linear-gradient(135deg, hsl(38 92% 50%), hsl(24 95% 58%))',
  },
  {
    id: 'rose',
    label: 'Rose',
    hint: '社交产品玫瑰红',
    preview: 'linear-gradient(135deg, hsl(342 82% 62%), hsl(320 78% 60%))',
  },
] as const;

function normalizeHex(input: string) {
  const value = String(input || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return `#${value.toLowerCase()}`;
}

export function Header({ activeAccount, mode, onModeChange }: HeaderProps) {
  const [time, setTime] = useState(new Date());
  const [themeDrawerOpen, setThemeDrawerOpen] = useState(false);
  const { lang, setLang, t } = useI18n();
  const { theme, toggleTheme, colorTheme, setColorTheme, customColor, setCustomColor } = useTheme();
  const [customColorDraft, setCustomColorDraft] = useState(customColor);

  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    setCustomColorDraft(customColor);
  }, [customColor]);

  const currentLang = LANG_FLAG[lang];
  const nextLang = lang === 'zh' ? 'en' : 'zh';
  const selectedThemeLabel = colorTheme === 'custom'
    ? 'Custom'
    : THEME_SWATCHES.find((swatch) => swatch.id === colorTheme)?.label || 'Violet';
  const customPreview = `linear-gradient(135deg, ${customColor}, color-mix(in srgb, ${customColor} 70%, white))`;
  const customColorValid = Boolean(normalizeHex(customColorDraft));

  const applyCustomColor = () => {
    const normalized = normalizeHex(customColorDraft);
    if (!normalized) return;
    setCustomColor(normalized);
    setColorTheme('custom');
  };

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-border/50 bg-card/50 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">{t('app.title')}</h1>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse-dot" />
          <span className="font-medium text-foreground">{activeAccount}</span>
        </div>

        <div className="flex h-7 items-center rounded-full border border-border/60 bg-secondary/45 px-3 text-xs font-medium text-foreground">
          Codex
        </div>

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

        <Sheet open={themeDrawerOpen} onOpenChange={setThemeDrawerOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-2 rounded-full border border-border/60 bg-secondary/45 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              title="打开主题设置"
            >
              <span
                className="h-4 w-4 rounded-full border border-white/20 shadow-sm"
                style={{ background: colorTheme === 'custom' ? customPreview : THEME_SWATCHES.find((swatch) => swatch.id === colorTheme)?.preview }}
              />
              <span>{selectedThemeLabel}</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[380px] border-border/60 bg-card/95 backdrop-blur-xl sm:max-w-[380px]">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-base">
                <Palette className="h-4 w-4 text-primary" />
                主题设置
              </SheetTitle>
              <SheetDescription>
                选择一套预制主题色，或者输入你自己的品牌颜色。
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <div className="rounded-2xl border border-border/60 bg-secondary/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">当前主题</p>
                    <p className="text-xs text-muted-foreground">
                      {theme === 'dark' ? '暗色模式' : '亮色模式'} · {selectedThemeLabel}
                    </p>
                  </div>
                  <div
                    className="h-12 w-20 rounded-2xl border border-white/10"
                    style={{ background: colorTheme === 'custom' ? customPreview : THEME_SWATCHES.find((swatch) => swatch.id === colorTheme)?.preview }}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  预设主题
                </div>
                <div className="space-y-2">
                  {THEME_SWATCHES.map((swatch) => {
                    const active = colorTheme === swatch.id;
                    return (
                      <button
                        key={swatch.id}
                        type="button"
                        onClick={() => setColorTheme(swatch.id)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition-colors ${
                          active
                            ? 'border-primary/50 bg-primary/10'
                            : 'border-border/60 bg-secondary/25 hover:bg-secondary/40'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="h-10 w-10 rounded-xl border border-white/10"
                            style={{ background: swatch.preview }}
                          />
                          <div>
                            <p className="text-sm font-medium text-foreground">{swatch.label}</p>
                            <p className="text-xs text-muted-foreground">{swatch.hint}</p>
                          </div>
                        </div>
                        {active && <Check className="h-4 w-4 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Palette className="h-4 w-4 text-primary" />
                  自定义颜色
                </div>
                <div className="rounded-2xl border border-border/60 bg-secondary/25 p-4 space-y-4">
                  <div
                    className="h-20 rounded-2xl border border-white/10"
                    style={{ background: customPreview }}
                  />

                  <div className="flex items-center gap-3">
                    <label
                      htmlFor="theme-color-picker"
                      className="flex h-11 w-14 cursor-pointer items-center justify-center rounded-xl border border-border/60 bg-background"
                    >
                      <input
                        id="theme-color-picker"
                        type="color"
                        value={customColor}
                        onChange={(e) => {
                          setCustomColorDraft(e.target.value);
                          setCustomColor(e.target.value);
                          setColorTheme('custom');
                        }}
                        className="h-8 w-8 cursor-pointer appearance-none border-0 bg-transparent p-0"
                      />
                    </label>

                    <Input
                      value={customColorDraft}
                      onChange={(e) => setCustomColorDraft(e.target.value)}
                      className="h-11 font-mono text-xs"
                      placeholder="#a855f7"
                    />

                    <Button
                      type="button"
                      className="h-11"
                      disabled={!customColorValid}
                      onClick={applyCustomColor}
                    >
                      应用
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/60 px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-foreground">使用自定义主题</p>
                      <p className="text-[11px] text-muted-foreground">输入任意 6 位十六进制颜色，例如 #7c3aed</p>
                    </div>
                    <Button
                      type="button"
                      variant={colorTheme === 'custom' ? 'default' : 'outline'}
                      className="h-8 text-xs"
                      onClick={() => setColorTheme('custom')}
                    >
                      {colorTheme === 'custom' ? '已启用' : '启用'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>

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
