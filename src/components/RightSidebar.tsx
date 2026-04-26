import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { PoolSettings } from '@/types';
import { PauseCircle, RefreshCcw, RotateCw, ShieldCheck, Zap, KeyRound, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export type QuickActionKey = 'rotate' | 'pauseAll' | 'pauseFiltered' | 'healthCheck' | 'checkAllUsage' | 'refreshAllTokens' | 'restartOpenClaw';

export interface QuickActionStatus {
  tone: 'idle' | 'running' | 'success' | 'error';
  label: string;
  detail?: string;
  progress?: {
    current: number;
    total: number;
    success: number;
  } | null;
}

interface RightSidebarProps {
  settings: PoolSettings;
  onSettingsChange: (settings: PoolSettings) => void;
  onRotateNow: () => void;
  onPauseAll: () => void;
  onHealthCheck: () => void;
  onRestartOpenClaw?: () => void;
  onRefreshAllTokens?: () => void;
  onCheckAllUsage?: () => void;
  busyAction?: QuickActionKey | null;
  actionStatus?: QuickActionStatus | null;
}

export function RightSidebar({
  settings,
  onSettingsChange,
  onRotateNow,
  onPauseAll,
  onHealthCheck,
  onRestartOpenClaw,
  onRefreshAllTokens,
  onCheckAllUsage,
  busyAction = null,
  actionStatus = null,
}: RightSidebarProps) {
  const { t } = useI18n();
  const runtimePathLabel = settings.mode === 'claude' ? t('right.claudePath') : t('right.codexPath');
  const runtimePathHint = settings.mode === 'claude' ? t('right.claudePathHint') : t('right.codexPathHint');
  const runtimeTargetHint = settings.mode === 'claude' ? t('right.runtimeTarget.claude') : t('right.runtimeTarget.codex');
  const openClawConfigured = Boolean(settings.openclaw_endpoint?.trim() || settings.openclaw_api_key?.trim() || settings.auto_dispatch);
  const hasRunningAction = Boolean(busyAction);
  const resolvedActionStatus = actionStatus ?? {
    tone: 'idle',
    label: t('right.actionStatusIdle'),
    detail: '',
    progress: null,
  };
  const actionToneClass = resolvedActionStatus.tone === 'error'
    ? 'border-destructive/30 bg-destructive/5'
    : resolvedActionStatus.tone === 'success'
      ? 'border-primary/30 bg-primary/5'
      : resolvedActionStatus.tone === 'running'
        ? 'border-info/30 bg-info/5'
        : 'border-border/50 bg-secondary/20';
  const actionToneTextClass = resolvedActionStatus.tone === 'error'
    ? 'text-destructive'
    : resolvedActionStatus.tone === 'success'
      ? 'text-primary'
      : resolvedActionStatus.tone === 'running'
        ? 'text-info'
        : 'text-muted-foreground';

  const update = (partial: Partial<PoolSettings>) => {
    onSettingsChange({ ...settings, ...partial });
  };

  return (
    <aside className="w-[280px] shrink-0 border-l border-border/50 bg-background/50 backdrop-blur-md overflow-y-auto">

      {/* 快捷操作 */}
      <div className="p-4 border-b border-border/50 space-y-2">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">{t('right.quickActions')}</h3>
        <Button onClick={onRotateNow} disabled={hasRunningAction} className="w-full h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-70">
          {busyAction === 'rotate' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5 mr-1.5" />}
          {t('right.rotateNext')}
        </Button>

        <Button onClick={onPauseAll} disabled={hasRunningAction} variant="outline" className="w-full h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10 disabled:opacity-70">
          {busyAction === 'pauseAll' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5 mr-1.5" />}
          {t('right.pauseAll')}
        </Button>

        <Button onClick={onHealthCheck} disabled={hasRunningAction} variant="outline" className="w-full h-8 text-xs border-info/30 text-info hover:bg-info/10 disabled:opacity-70">
          {busyAction === 'healthCheck' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
          {t('right.healthCheck')}
        </Button>

        {onCheckAllUsage && (
          <Button onClick={onCheckAllUsage} disabled={hasRunningAction} variant="outline" className="w-full h-8 text-xs border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-70">
            {busyAction === 'checkAllUsage' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
            {t('right.checkAllUsage')}
          </Button>
        )}

        {onRefreshAllTokens && (
          <Button onClick={onRefreshAllTokens} disabled={hasRunningAction} variant="outline" className="w-full h-8 text-xs border-warning/30 text-warning hover:bg-warning/10 disabled:opacity-70">
            {busyAction === 'refreshAllTokens' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5 mr-1.5" />}
            {t('right.refreshAllTokens')}
          </Button>
        )}

        <div className={`rounded-lg border px-3 py-2 ${actionToneClass}`}>
          <p className="text-[11px] font-medium text-foreground">{t('right.actionStatus')}</p>
          <p className={`mt-1 text-[11px] font-medium ${actionToneTextClass}`}>
            {resolvedActionStatus.tone === 'running'
              ? t('right.actionStatusRunning')
              : resolvedActionStatus.tone === 'success'
                ? t('right.actionStatusSuccess')
                : resolvedActionStatus.tone === 'error'
                  ? t('right.actionStatusError')
                  : t('right.actionStatusIdle')}
          </p>
          <p className="mt-1 text-[11px] leading-4 text-foreground/85">{resolvedActionStatus.label}</p>
          {resolvedActionStatus.detail ? (
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{resolvedActionStatus.detail}</p>
          ) : null}
          {resolvedActionStatus.progress ? (
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {t('right.actionProgress', resolvedActionStatus.progress)}
            </p>
          ) : null}
        </div>
      </div>

      {/* 轮换策略 */}
      <div className="p-4 border-b border-border/50 space-y-4">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">{t('right.rotationSettings')}</h3>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('right.strategy')}</Label>
          <Select value={settings.strategy} onValueChange={(v) => update({ strategy: v as PoolSettings['strategy'] })}>
            <SelectTrigger className="h-8 text-xs bg-input border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="round_robin">{t('right.strategy.round_robin')}</SelectItem>
              <SelectItem value="least_used">{t('right.strategy.least_used')}</SelectItem>
              <SelectItem value="random">{t('right.strategy.random')}</SelectItem>
              <SelectItem value="priority_based">{t('right.strategy.priority_based')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {t('right.strategyHint')}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">{t('right.autoRotation')}</Label>
          <Switch checked={settings.auto_rotation} onCheckedChange={(v) => update({ auto_rotation: v })} />
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {t('right.autoRotationHint')}
        </p>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">{t('right.autoTokenRefresh')}</Label>
          <Switch checked={settings.auto_token_refresh} onCheckedChange={(v) => update({ auto_token_refresh: v })} />
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {t('right.autoTokenRefreshHint')}
        </p>

        {settings.auto_token_refresh && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('right.refreshInterval')}</Label>
            <Select
              value={String(settings.token_refresh_interval_hours)}
              onValueChange={(v) => update({ token_refresh_interval_hours: Number(v) })}
            >
              <SelectTrigger className="h-8 text-xs bg-input border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24h (1 天)</SelectItem>
                <SelectItem value="48">48h (2 天)</SelectItem>
                <SelectItem value="72">72h (3 天)</SelectItem>
                <SelectItem value="120">120h (5 天)</SelectItem>
                <SelectItem value="168">168h (7 天)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-4 text-muted-foreground">
              {t('right.refreshIntervalHint')}
            </p>
          </div>
        )}
      </div>

      {/* CLI 路径 */}
      <div className="p-4 border-b border-border/50 space-y-3">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">{t('right.cliConfig')}</h3>

        <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
          <p className="text-[11px] font-medium text-foreground">{t('right.runtimeTarget')}</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {runtimeTargetHint}
          </p>
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">{runtimePathLabel}</Label>
          <Input
            value={settings.mode === 'claude' ? (settings.claude_path ?? '') : (settings.codex_path ?? '')}
            onChange={(e) => update(settings.mode === 'claude' ? { claude_path: e.target.value } : { codex_path: e.target.value })}
            className="h-7 text-xs bg-input border-border/50 font-mono"
            placeholder={settings.mode === 'claude' ? '留空自动探测，或填写 claude.cmd / claude.exe' : '留空自动探测，或填写 codex.cmd / codex.exe'}
          />
          <p className="text-[11px] leading-4 text-muted-foreground">
            {runtimePathHint}
          </p>
        </div>
      </div>

      {/* Openclaw 集成 */}
      <div className="p-4 space-y-3">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">{t('right.openclawIntegration')}</h3>

        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${openClawConfigured ? 'bg-primary' : 'bg-muted-foreground/50'}`} />
          <span className="text-muted-foreground">
            {openClawConfigured ? t('right.openclawConfigured') : t('right.openclawOptional')}
          </span>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {openClawConfigured ? t('right.openclawConfiguredHint') : t('right.openclawHint')}
        </p>

        <div className="space-y-1">
          <details className="rounded-md border border-border/50 bg-background/40 px-3 py-2">
            <summary className="cursor-pointer list-none text-xs text-muted-foreground">
              {t('right.openclawAdvanced')}
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-[11px] leading-4 text-muted-foreground">
                {t('right.openclawAdvancedHint')}
              </p>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('right.endpoint')}</Label>
                <Input
                  value={settings.openclaw_endpoint ?? ''}
                  onChange={(e) => update({ openclaw_endpoint: e.target.value })}
                  className="h-7 text-xs bg-input border-border/50 font-mono"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('right.apiKey')}</Label>
                <Input
                  type="password"
                  value={settings.openclaw_api_key ?? ''}
                  onChange={(e) => update({ openclaw_api_key: e.target.value })}
                  className="h-7 text-xs bg-input border-border/50"
                  placeholder="••••••••"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">{t('right.autoDispatch')}</Label>
                <Switch checked={settings.auto_dispatch} onCheckedChange={(v) => update({ auto_dispatch: v })} />
              </div>
            </div>
          </details>
        </div>

        {onRestartOpenClaw && openClawConfigured && (
          <Button onClick={onRestartOpenClaw} disabled={hasRunningAction} variant="outline" className="w-full h-8 text-xs border-info/30 text-info hover:bg-info/10 disabled:opacity-70">
            {busyAction === 'restartOpenClaw' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />}
            {t('right.reloadOpenClaw')}
          </Button>
        )}
      </div>
    </aside>
  );
}
