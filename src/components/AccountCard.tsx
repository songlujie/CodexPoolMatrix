import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MoreHorizontal, AlertCircle, CheckCircle2, Clock, Zap, Eye, EyeOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Account, LiveUsageData } from '@/types';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { formatDistanceToNow, differenceInDays, differenceInHours } from 'date-fns';
import { useI18n } from '@/lib/i18n';
import { PlatformIcon } from './PlatformIcon';
import { AccountCardCliConfigDialog } from './AccountCardCliConfigDialog';
import { barColor, maskEmail, oauthTypeBadge, statusBadge, statusBorderClass } from './account-card.constants';

interface AccountCardProps {
  account: Account;
  onSetActive: (id: string) => void;
  onPause: (id: string) => void;
  onReset: (id: string) => void;
  onRemove: (id: string) => Promise<void>;
  refreshKey?: number;
  viewMode?: 'grid' | 'list';
  externalUsage?: LiveUsageData | null;
  onUsageUpdate?: (id: string, usage: LiveUsageData) => void;
}

type AuthInfo = Awaited<ReturnType<typeof api.getAccountAuthInfo>>;

export function AccountCard({ account, onSetActive, onPause, onReset, onRemove, refreshKey, viewMode = 'grid', externalUsage, onUsageUpdate }: AccountCardProps) {
  const sb = statusBadge[account.status];
  const { t, dateLocale } = useI18n();
  const isApiAccount = account.provider_mode === 'api';
  const tb = isApiAccount
    ? {
        label: t(`card.apiGroup.${account.auth_type}` as 'card.apiGroup.team' | 'card.apiGroup.plus' | 'card.apiGroup.free'),
        className: oauthTypeBadge[account.auth_type].className,
      }
    : oauthTypeBadge[account.auth_type];

  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [usageResult, setUsageResult] = useState<Awaited<ReturnType<typeof api.checkAccountUsage>> | null>(null);
  const [checkingUsage, setCheckingUsage] = useState(false);
  const [liveUsage, setLiveUsage] = useState<LiveUsageData | null>(externalUsage ?? null);
  const [fetchingLive, setFetchingLive] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [cliConfigOpen, setCliConfigOpen] = useState(false);
  const [cliConfigValue, setCliConfigValue] = useState(account.api_cli_config || '');
  const [savingCliConfig, setSavingCliConfig] = useState(false);
  const [cliConfigPreview, setCliConfigPreview] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const didAutoRefreshRef = useRef(false);
  const cliConfigSummarySource = authInfo?.api_cli_config || account.api_cli_config || '';
  const cliConfigLineCount = cliConfigSummarySource
    ? cliConfigSummarySource.split(/\r?\n/).map(line => line.trim()).filter(Boolean).length
    : 0;

  const formatUsageError = useCallback((error?: string) => {
    if (!error) return t('card.checkFailed');

    if (error === 'auth_file_not_found') return t('card.authNotFound');
    if (error === 'invalid_auth_file') return t('card.authReadFail');
    if (error === 'no_access_token') return t('card.noAccessToken');
    if (error === 'token_invalid') return t('card.tokenInvalid');
    if (error === 'api_base_url_missing') return t('card.apiBaseUrlMissing');
    if (error === 'api_key_missing') return t('card.apiKeyMissing');
    if (error === 'api_model_not_found') return t('card.apiModelNotFound');
    if (error.includes('连接中转站超时')) return t('card.apiRelayTimeout');

    if (error.includes('连接 chatgpt.com 超时') || error.includes('UND_ERR_CONNECT_TIMEOUT')) {
      return t('card.proxyTimeout');
    }
    if (error.includes('无法解析 chatgpt.com')) {
      return t('card.proxyDnsError');
    }
    if (error.includes('连接被拒绝')) {
      return t('card.proxyRefused');
    }
    if (error.includes('连接被重置')) {
      return t('card.proxyReset');
    }
    if (error.startsWith('http_')) {
      return `${t('card.checkFailed')} (${error.slice(5)})`;
    }

    return error;
  }, [t]);

  function expiryInfo(expiresAt: string | undefined, kind: 'plan' | 'token') {
    if (!expiresAt) return null;
    const exp = new Date(expiresAt);
    const now = new Date();
    const exactDate = exp.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    if (exp < now) {
      return {
        label: `${t(kind === 'plan' ? 'card.planExpired' : 'card.tokenExpired')} · ${t('card.expiresOn', { date: exactDate })}`,
        color: 'text-destructive',
      };
    }
    const days = differenceInDays(exp, now);
    const hours = differenceInHours(exp, now);
    if (days >= 1) {
      return {
        label: `${t(kind === 'plan' ? 'card.planDaysLeft' : 'card.tokenDaysLeft', { days })} · ${t('card.expiresOn', { date: exactDate })}`,
        color: days <= 3 ? 'text-warning' : 'text-primary',
      };
    }
    return {
      label: `${t(kind === 'plan' ? 'card.planHoursLeft' : 'card.tokenHoursLeft', { hours })} · ${t('card.expiresOn', { date: exactDate })}`,
      color: 'text-destructive',
    };
  }

  const fetchAuthInfo = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const info = await api.getAccountAuthInfo(account.id);
      setAuthInfo(info);
    } catch {
      setAuthInfo(null);
    } finally {
      setLoadingInfo(false);
    }
  }, [account.id]);

  // OAuth 账号做可用性+用量刷新，API 账号做中转站连通性检测
  const handleRefreshLiveUsage = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    setFetchingLive(true);
    setCheckingUsage(true);
    setUsageResult(null);
    try {
      const result = await api.checkAccountUsage(account.id);
      setUsageResult(result);

      if (result.ok) {
        if (result.provider === 'api') {
          const usage: LiveUsageData = {
            ok: true,
            fetched_at: result.fetched_at,
            plan_type: result.plan_type,
            primary: null,
            secondary: null,
          };
          setLiveUsage(usage);
          onUsageUpdate?.(account.id, usage);
          if (!silent) {
            toast.success(`${account.account_id} ${t('card.apiRelayOk')}`);
          }
        } else {
          const usage: LiveUsageData = {
            ok: true,
            fetched_at: result.fetched_at,
            plan_type: result.plan_type,
            primary: result.primary,
            secondary: result.secondary,
          };
          setLiveUsage(usage);
          onUsageUpdate?.(account.id, usage);
          if (!silent) {
            toast.success(`${account.account_id} ${t('card.codexAvailable')} (5h=${result.primary?.used_percent ?? '?'}%)`);
          }
        }
      } else if (result.rate_limited) {
        if (result.primary || result.secondary) {
          const usage: LiveUsageData = {
            ok: false, error: 'rate_limited',
            fetched_at: result.fetched_at,
            primary: result.primary,
            secondary: result.secondary,
          };
          setLiveUsage(usage);
          onUsageUpdate?.(account.id, usage);
        }
        if (!silent) {
          toast.warning(`${account.account_id} ${t('card.codexRateLimited')}`);
        }
      } else if (result.status === 401) {
        if (!silent) {
          toast.error(`${account.account_id} ${t('card.tokenInvalid')}`);
        }
      } else {
        if (!silent) {
          toast.error(`${account.account_id}: ${formatUsageError(result.error)}`);
        }
      }
    } catch {
      if (!silent) {
        toast.error(t('card.checkFailed'));
      }
    } finally {
      setFetchingLive(false);
      setCheckingUsage(false);
    }
  }, [account.account_id, account.id, formatUsageError, onUsageUpdate, t]);

  useEffect(() => {
    void fetchAuthInfo();
  }, [account.auth_file_path, fetchAuthInfo, refreshKey]);

  // Sync usage data pushed from parent (batch refresh)
  useEffect(() => {
    if (externalUsage != null) {
      setLiveUsage(externalUsage);
    }
  }, [externalUsage]);

  useEffect(() => {
    setCliConfigValue(account.api_cli_config || authInfo?.api_cli_config || '');
  }, [account.api_cli_config, authInfo?.api_cli_config]);

  // 账号变为活跃时自动获取实时用量
  useEffect(() => {
    if (!account.is_current) {
      didAutoRefreshRef.current = false;
      return;
    }
    if (didAutoRefreshRef.current) return;

    didAutoRefreshRef.current = true;
    void handleRefreshLiveUsage({ silent: true });
  }, [account.is_current, handleRefreshLiveUsage]);

  useEffect(() => {
    if (!cliConfigOpen || !isApiAccount) return;

    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api.previewApiCliConfig(account.id, cliConfigValue);
        if (!cancelled) {
          setCliConfigPreview(result.preview || '');
        }
      } catch {
        if (!cancelled) {
          setCliConfigPreview('');
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [account.id, cliConfigOpen, cliConfigValue, isApiAccount]);

  const handleSaveApiCliConfig = async () => {
    setSavingCliConfig(true);
    try {
      await api.updateApiCliConfig(account.id, cliConfigValue);
      await fetchAuthInfo();
      setCliConfigOpen(false);
      toast.success(t('card.apiCliConfigSaved'));
    } catch (error) {
      toast.error((error as Error)?.message || t('card.apiCliConfigSaveFailed'));
    } finally {
      setSavingCliConfig(false);
    }
  };

  const tokenExpiry = expiryInfo(authInfo?.token_expires_at, 'token');
  const planExpiry = expiryInfo(authInfo?.subscription_expires_at, 'plan');
  const hasAuthFile = authInfo && !authInfo.error;
  const apiHealthTone = !usageResult
    ? 'border-border/50 bg-muted/20'
    : usageResult.ok && usageResult.model_available !== false
      ? 'border-primary/30 bg-primary/5'
      : 'border-destructive/25 bg-destructive/5';
  const apiHealthTextTone = !usageResult
    ? 'text-muted-foreground'
    : usageResult.ok && usageResult.model_available !== false
      ? 'text-primary font-medium'
      : 'text-destructive font-medium';
  const providerBadge = isApiAccount
    ? { label: t('card.provider.api'), className: 'bg-amber-500/10 text-amber-700 border-amber-500/25' }
    : { label: t('card.provider.oauth'), className: 'bg-sky-500/10 text-sky-700 border-sky-500/25' };
  const deleteDisabled = account.is_current;
  const handleRefreshToken = async () => {
    try {
      toast.info(`正在刷新 ${account.account_id} 的 Token...`);
      const result = await api.refreshToken(account.id);
      if (result.ok) {
        toast.success(`${account.account_id} ${t('card.refreshTokenSuccess')}`);
        await fetchAuthInfo();
      } else {
        toast.error(`刷新失败: ${result.reason}`);
      }
    } catch {
      toast.error(t('card.refreshTokenFailed'));
    }
  };
  const renderMenuContent = () => (
    <DropdownMenuContent align="end" className="text-xs">
      <DropdownMenuItem onClick={() => onSetActive(account.id)}>{t('card.menuSetActive')}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onPause(account.id)}>{t('card.menuPause')}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onReset(account.id)}>{t('card.menuReset')}</DropdownMenuItem>
      {isApiAccount && (
        <DropdownMenuItem onClick={() => setCliConfigOpen(true)}>{t('card.menuEditCliConfig')}</DropdownMenuItem>
      )}
      {!isApiAccount && (
        <DropdownMenuItem onClick={handleRefreshToken} className="text-green-500">{t('card.menuRefreshToken')}</DropdownMenuItem>
      )}
      <DropdownMenuItem
        onClick={() => {
          if (!deleteDisabled) {
            void onRemove(account.id);
          }
        }}
        disabled={deleteDisabled}
        className={deleteDisabled ? 'text-muted-foreground' : 'text-destructive'}
      >
        {deleteDisabled ? t('card.menuRemoveDisabled') : t('card.menuRemove')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
  const cliConfigDialog = isApiAccount ? (
    <AccountCardCliConfigDialog
      accountId={account.account_id}
      open={cliConfigOpen}
      onOpenChange={setCliConfigOpen}
      value={cliConfigValue}
      onValueChange={setCliConfigValue}
      preview={cliConfigPreview}
      previewLoading={previewLoading}
      saving={savingCliConfig}
      onSave={() => void handleSaveApiCliConfig()}
      title={t('card.apiCliConfig')}
      previewLabel={t('card.apiCliConfigPreview')}
      emptyLabel={t('card.apiCliConfigEmpty')}
    />
  ) : null;

  // ── Compact list row ──
  if (viewMode === 'list') {
    return (
      <>
        <motion.div
          layout
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6 }}
          transition={{ duration: 0.12 }}
          className={`relative flex items-center gap-3 rounded-lg bg-card px-3 py-2 card-shadow transition-all duration-200 hover:card-shadow-hover ${statusBorderClass[account.status]} ${account.is_current ? 'active-glow' : ''}`}
          style={account.is_current ? { order: -1 } : undefined}
        >
          {/* Platform icon */}
          <div className="shrink-0">
            <PlatformIcon platform={account.platform || 'gpt'} size={18} />
          </div>

          {/* Account name + status */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {account.is_current && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot shrink-0" />}
            <span className="text-sm font-semibold text-foreground truncate">{account.account_id}</span>
            <Badge variant="outline" className={`text-[9px] h-4 px-1.5 shrink-0 ${providerBadge.className}`}>
              {providerBadge.label}
            </Badge>
            <Badge variant="outline" className={`text-[9px] h-4 px-1.5 shrink-0 ${tb.className}`}>
              {tb.label}
            </Badge>
            <Badge variant="outline" className={`text-[9px] h-4 px-1.5 shrink-0 ${statusBadge[account.status].className}`}>
              {statusBadge[account.status].label}
            </Badge>
          </div>

          {/* Email (masked) */}
          <div className="hidden sm:flex items-center gap-1 min-w-0 w-40 shrink-0">
            {isApiAccount ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                <span className="text-[11px] text-muted-foreground truncate">
                  {authInfo?.api_model || account.api_model || authInfo?.email || account.email || account.account_id}
                </span>
              </>
            ) : hasAuthFile ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                <span className="text-[11px] text-muted-foreground truncate">
                  {showEmail
                    ? (authInfo.email ?? account.email)
                    : maskEmail(authInfo.email ?? account.email ?? '')}
                </span>
                <button
                  onClick={() => setShowEmail(v => !v)}
                  className="shrink-0 h-4 w-4 flex items-center justify-center rounded hover:bg-secondary/50 text-muted-foreground"
                >
                  {showEmail ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                </button>
              </>
            ) : (
              <span className="text-[11px] text-destructive truncate">{t('card.noAuth')}</span>
            )}
          </div>

          {/* Usage bars (if available) */}
          <div className="hidden md:flex items-center gap-3 w-44 shrink-0">
            {liveUsage?.primary && (
              <div className="flex items-center gap-1.5 flex-1">
                <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full rounded-full ${barColor(liveUsage.primary.used_percent)}`}
                    style={{ width: `${Math.min(liveUsage.primary.used_percent, 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground w-8 text-right tabular-nums">
                  {liveUsage.primary.used_percent.toFixed(0)}%
                </span>
              </div>
            )}
            {!liveUsage?.primary && (
              <span className="text-[10px] text-muted-foreground">—</span>
            )}
          </div>

          {/* Token expiry */}
          {(planExpiry || tokenExpiry) && (
            <span className={`hidden lg:block text-[10px] shrink-0 ${(planExpiry || tokenExpiry)?.color}`}>{(planExpiry || tokenExpiry)?.label}</span>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0 ml-auto">
            <button
              onClick={handleRefreshLiveUsage}
              disabled={fetchingLive}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-secondary/50 text-muted-foreground disabled:opacity-40"
              title={t('card.checkAvailability')}
            >
              <Zap className={`h-3.5 w-3.5 ${fetchingLive ? 'animate-pulse text-primary' : ''}`} />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger className="h-6 w-6 flex items-center justify-center rounded hover:bg-secondary/50 text-muted-foreground">
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              {renderMenuContent()}
            </DropdownMenu>
          </div>
        </motion.div>
        {cliConfigDialog}
      </>
    );
  }

  // ── Full grid card ──
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className={`relative overflow-hidden rounded-xl bg-card p-4 card-shadow transition-all duration-200 hover:-translate-y-0.5 hover:card-shadow-hover ${statusBorderClass[account.status]} ${account.is_current ? 'active-glow' : ''}`}
      style={account.is_current ? { order: -1 } : undefined}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {account.is_current && <span className="h-2 w-2 rounded-full bg-primary animate-pulse-dot" />}
          {/* Platform logo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center justify-center">
                <PlatformIcon platform={account.platform || 'gpt'} size={16} />
              </span>
            </TooltipTrigger>
            <TooltipContent className="text-xs capitalize">{account.platform || 'gpt'}</TooltipContent>
          </Tooltip>
          <span className="text-sm font-bold text-foreground">{account.account_id}</span>
          <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${providerBadge.className}`}>{providerBadge.label}</Badge>
          <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${tb.className}`}>{tb.label}</Badge>
          <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${sb.className}`}>{sb.label}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="h-6 w-6 flex items-center justify-center rounded hover:bg-secondary/50 text-muted-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            {renderMenuContent()}
          </DropdownMenu>
        </div>
      </div>

      {/* 邮箱 + Auth 状态 */}
      <div className="mb-3">
        {loadingInfo ? (
          <p className="text-[11px] text-muted-foreground">{t('card.readingInfo')}</p>
        ) : isApiAccount ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
              <p className="text-[11px] text-foreground font-medium truncate max-w-[170px]">
                {authInfo?.email || account.email || account.account_id}
              </p>
            </div>
            <div className="text-[10px] text-muted-foreground break-all">
              {t('card.apiBaseUrl')}：{authInfo?.api_base_url || account.api_base_url || t('common.none')}
            </div>
            <div className="text-[10px] text-muted-foreground break-all">
              {t('card.apiModel')}：{authInfo?.api_model || account.api_model || t('common.none')}
            </div>
            <div className="text-[10px] text-muted-foreground rounded-md border border-border/40 bg-muted/20 px-2 py-1.5">
              {t('card.apiCliConfig')}：{cliConfigLineCount > 0 ? t('card.apiCliConfigSummary', { lines: cliConfigLineCount }) : t('card.apiCliConfigEmpty')}
            </div>
          </div>
        ) : hasAuthFile ? (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
              <p className="text-[11px] text-foreground font-medium truncate max-w-[170px]">
                {showEmail
                  ? (authInfo.email ?? account.email)
                  : maskEmail(authInfo.email ?? account.email ?? '')}
              </p>
              <button
                onClick={() => setShowEmail(v => !v)}
                className="h-4 w-4 flex items-center justify-center rounded hover:bg-secondary/50 text-muted-foreground shrink-0"
                title={showEmail ? t('card.hideEmail') : t('card.showEmail')}
              >
                {showEmail ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
              </button>
            </div>
            {planExpiry && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                <p className={`text-[11px] ${planExpiry.color}`}>{planExpiry.label}</p>
              </div>
            )}
            {tokenExpiry && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                <p className={`text-[11px] ${tokenExpiry.color}`}>{tokenExpiry.label}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
            <p className="text-[11px] text-destructive">
              {authInfo?.error === 'auth_file_not_found'
                ? `${t('card.authNotFound')}: ${authInfo.path}`
                : t('card.authReadFail')}
            </p>
          </div>
        )}
      </div>

      {/* OpenAI 用量（5h / 周） */}
      {hasAuthFile && authInfo.usage && (
        <div className="space-y-1.5 mb-3 text-[11px]">
          {authInfo.usage.message_cap != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('card.5hUsageCap')}</span>
              <span className="text-foreground">{authInfo.usage.message_cap}</span>
            </div>
          )}
          {authInfo.usage.message_cap_rollover && (
            <div className="text-[10px] text-muted-foreground">
              {t('card.resetTime')}：{new Date(authInfo.usage.message_cap_rollover).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}

      {/* OAuth 用量 / API 中转站状态 */}
      {(() => {
        const isLive = liveUsage?.ok || (liveUsage && 'primary' in liveUsage);
        const primary = liveUsage?.primary ?? null;
        const secondary = liveUsage?.secondary ?? null;
        const fetchedAt = liveUsage?.fetched_at;

        return (
          <div className="mb-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                {isApiAccount ? t('card.apiRelayUsage') : t('card.codexUsage')}
              </span>
              <div className="flex items-center gap-1.5">
                {fetchedAt && (
                  <span className="text-[9px] text-muted-foreground">
                    {isLive ? `${t('card.live')} · ` : `${t('card.stale')} · `}
                    {formatDistanceToNow(new Date(fetchedAt), { addSuffix: true, locale: dateLocale })}
                  </span>
                )}
              </div>
            </div>

            {fetchingLive ? (
              <p className="text-[11px] text-muted-foreground">{isApiAccount ? t('card.apiChecking') : t('card.refreshing')}</p>
            ) : isApiAccount ? (
              <div className={`rounded-lg border px-3 py-2 space-y-2 ${apiHealthTone}`}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">{t('card.apiModelStatus')}</span>
                  <span className={apiHealthTextTone}>
                    {usageResult
                      ? (usageResult.model_available === false ? t('card.apiModelUnavailable') : t('card.apiModelReachable'))
                      : t('card.noData')}
                  </span>
                </div>
                {typeof usageResult?.model_count === 'number' && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{t('card.apiModelCount')}</span>
                    <span className="text-foreground tabular-nums">{usageResult.model_count}</span>
                  </div>
                )}
                {!usageResult && account.is_current && (
                  <button
                    onClick={handleRefreshLiveUsage}
                    className="text-[10px] text-primary hover:underline"
                  >
                    {t('card.apiClickToCheck')}
                  </button>
                )}
              </div>
            ) : !primary && !secondary ? (
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">{t('card.noData')}</p>
                {account.is_current && (
                  <button
                    onClick={handleRefreshLiveUsage}
                    className="text-[10px] text-primary hover:underline"
                  >
                    {isApiAccount ? t('card.apiClickToCheck') : t('card.clickToFetch')}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {primary && (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">{t('card.5hWindow')}</span>
                      <span className={primary.used_percent >= 80 ? 'text-destructive font-medium' : primary.used_percent >= 50 ? 'text-warning font-medium' : 'text-foreground'}>
                        {primary.used_percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor(primary.used_percent)}`} style={{ width: `${Math.min(primary.used_percent, 100)}%` }} />
                    </div>
                    {primary.resets_at && (
                      <p className="text-[10px] text-muted-foreground">
                        {t('card.resetTime')}：{new Date(primary.resets_at) < new Date() ? t('card.resetDone') : formatDistanceToNow(new Date(primary.resets_at), { addSuffix: true, locale: dateLocale })}
                      </p>
                    )}
                  </div>
                )}
                {secondary && (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">{t('card.weeklyUsage')}</span>
                      <span className={secondary.used_percent >= 80 ? 'text-destructive font-medium' : secondary.used_percent >= 50 ? 'text-warning font-medium' : 'text-foreground'}>
                        {secondary.used_percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor(secondary.used_percent)}`} style={{ width: `${Math.min(secondary.used_percent, 100)}%` }} />
                    </div>
                    {secondary.resets_at && (
                      <p className="text-[10px] text-muted-foreground">
                        {t('card.resetTime')}：{new Date(secondary.resets_at) < new Date() ? t('card.resetDone') : formatDistanceToNow(new Date(secondary.resets_at), { addSuffix: true, locale: dateLocale })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* 检测按钮 */}
      <div className="mb-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-[11px] gap-1.5"
          onClick={handleRefreshLiveUsage}
          disabled={fetchingLive}
        >
          <Zap className={`h-3 w-3 ${fetchingLive ? 'animate-pulse' : ''}`} />
          {fetchingLive
            ? (isApiAccount ? t('card.apiChecking') : t('card.checking'))
            : (isApiAccount ? t('card.checkRelay') : t('card.checkAvailability'))}
        </Button>

        {usageResult && (
          <div className={`mt-2 rounded-md px-3 py-2 text-[11px] ${
            usageResult.ok && (usageResult.provider !== 'api' || usageResult.model_available !== false) ? 'bg-primary/5 border border-primary/20' :
            usageResult.rate_limited ? 'bg-destructive/10 border border-destructive/20' :
            'bg-destructive/10 border border-destructive/20'
          }`}>
            <div className="flex items-center gap-1.5 font-medium">
              {usageResult.ok && (usageResult.provider !== 'api' || usageResult.model_available !== false) ? (
                <><CheckCircle2 className="h-3 w-3 text-primary" /><span className="text-primary">{usageResult.provider === 'api' ? t('card.apiRelayOk') : t('card.codexAvailable')}</span></>
              ) : usageResult.rate_limited ? (
                <><AlertCircle className="h-3 w-3 text-destructive" /><span className="text-destructive">{t('card.codexRateLimited')}</span></>
              ) : usageResult.status === 401 ? (
                <><AlertCircle className="h-3 w-3 text-destructive" /><span className="text-destructive">{t('card.tokenInvalid')}</span></>
              ) : (
                <><AlertCircle className="h-3 w-3 text-destructive" /><span className="text-destructive">{formatUsageError(usageResult.error)}</span></>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 上次请求 */}
      <div className="flex gap-3 text-[10px] text-muted-foreground mb-3">
        <Tooltip>
          <TooltipTrigger>
            {t('card.lastReq')}: {formatDistanceToNow(new Date(account.last_request_at), { addSuffix: true, locale: dateLocale })}
          </TooltipTrigger>
          <TooltipContent className="text-xs">{new Date(account.last_request_at).toLocaleString()}</TooltipContent>
        </Tooltip>
        {authInfo?.last_refresh && (
          <Tooltip>
            <TooltipTrigger>
              {t('card.tokenRefresh')}: {formatDistanceToNow(new Date(authInfo.last_refresh), { addSuffix: true, locale: dateLocale })}
            </TooltipTrigger>
            <TooltipContent className="text-xs">{new Date(authInfo.last_refresh).toLocaleString()}</TooltipContent>
          </Tooltip>
        )}
      </div>


      {/* Warning Banners */}
      {account.status === 'error' && (
        <div className="mt-3 -mx-4 -mb-4 px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-[11px] text-destructive">
          {t('card.errorWarning')}
        </div>
      )}
      {account.status === 'rate_limited' && (
        <div className="mt-3 -mx-4 -mb-4 px-4 py-2 bg-warning/10 border-t border-warning/20 text-[11px] text-warning">
          {t('card.rateLimitWarning')}
        </div>
      )}
      {hasAuthFile && tokenExpiry?.color === 'text-destructive' && account.status !== 'error' && (
        <div className="mt-3 -mx-4 -mb-4 px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-[11px] text-destructive">
          {tokenExpiry.label}{t('card.tokenExpireWarning')}
        </div>
      )}
      {cliConfigDialog}
    </motion.div>
  );
}
