import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { MoreHorizontal, RefreshCw, AlertCircle, CheckCircle2, Clock, Zap, Eye, EyeOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Account } from '@/types';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { formatDistanceToNow, differenceInDays, differenceInHours } from 'date-fns';

interface AccountCardProps {
  account: Account;
  onSetActive: (id: string) => void;
  onPause: (id: string) => void;
  onReset: (id: string) => void;
  onRemove: (id: string) => void;
}

type AuthInfo = Awaited<ReturnType<typeof api.getAccountAuthInfo>>;
type CodexUsage = Awaited<ReturnType<typeof api.getCodexUsage>>;
type LiveUsage = Awaited<ReturnType<typeof api.refreshCodexUsage>>;

const statusBorderClass: Record<Account['status'], string> = {
  active: 'status-border-active',
  idle: 'status-border-idle',
  error: 'status-border-error',
  rate_limited: 'status-border-warning',
  cooldown: 'status-border-cooldown',
};

const statusBadge: Record<Account['status'], { label: string; className: string }> = {
  active: { label: 'ACTIVE', className: 'bg-primary/15 text-primary border-primary/30' },
  idle: { label: 'IDLE', className: 'bg-muted/30 text-muted-foreground border-muted/50' },
  error: { label: 'ERROR', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  rate_limited: { label: 'RATE LIMITED', className: 'bg-warning/15 text-warning border-warning/30' },
  cooldown: { label: 'COOLDOWN', className: 'bg-info/15 text-info border-info/30' },
};

const typeBadge: Record<Account['auth_type'], { label: string; className: string }> = {
  team: { label: 'TEAM', className: 'bg-info/15 text-info border-info/30' },
  plus: { label: 'PLUS', className: 'bg-primary/15 text-primary border-primary/30' },
  free: { label: 'FREE', className: 'bg-muted/30 text-muted-foreground border-muted/50' },
};

/** 距过期时间的友好描述 + 颜色 */
function tokenExpiryInfo(expiresAt: string | undefined) {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt);
  const now = new Date();
  if (exp < now) return { label: 'Token 已过期', color: 'text-destructive' };
  const days = differenceInDays(exp, now);
  const hours = differenceInHours(exp, now);
  if (days >= 1) return { label: `Token 还剩 ${days} 天`, color: days <= 3 ? 'text-warning' : 'text-primary' };
  return { label: `Token 还剩 ${hours} 小时`, color: 'text-destructive' };
}

/** 进度条颜色 */
function barColor(pct: number) {
  if (pct >= 80) return 'bg-destructive';
  if (pct >= 50) return 'bg-warning';
  return 'bg-primary';
}

export function AccountCard({ account, onSetActive, onPause, onReset, onRemove }: AccountCardProps) {
  const sb = statusBadge[account.status];
  const tb = typeBadge[account.auth_type];

  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [usageResult, setUsageResult] = useState<Awaited<ReturnType<typeof api.checkAccountUsage>> | null>(null);
  const [checkingUsage, setCheckingUsage] = useState(false);
  const [codexUsage, setCodexUsage] = useState<CodexUsage | null>(null);
  const [loadingCodexUsage, setLoadingCodexUsage] = useState(false);
  const [liveUsage, setLiveUsage] = useState<LiveUsage | null>(null);
  const [fetchingLive, setFetchingLive] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  const fetchAuthInfo = async () => {
    setLoadingInfo(true);
    try {
      const info = await api.getAccountAuthInfo(account.id);
      setAuthInfo(info);
    } catch {
      setAuthInfo(null);
    } finally {
      setLoadingInfo(false);
    }
  };

  const handleCheckUsage = async () => {
    setCheckingUsage(true);
    setUsageResult(null);
    try {
      const result = await api.checkAccountUsage(account.id);
      setUsageResult(result);
      if (result.ok) {
        toast.success(`${account.account_id} 可用`);
      } else if (result.rate_limited) {
        toast.warning(`${account.account_id} 已触发速率限制`);
      } else if (result.status === 401) {
        toast.error(`${account.account_id} Token 已失效，请重新登录`);
      } else {
        toast.error(`${account.account_id} 检测失败: ${result.error ?? 'Unknown'}`);
      }
    } catch (e) {
      toast.error('检测请求失败');
    } finally {
      setCheckingUsage(false);
    }
  };

  const fetchCodexUsage = async () => {
    setLoadingCodexUsage(true);
    try {
      const data = await api.getCodexUsage();
      setCodexUsage(data);
    } catch {
      setCodexUsage(null);
    } finally {
      setLoadingCodexUsage(false);
    }
  };

  const handleRefreshLiveUsage = async () => {
    setFetchingLive(true);
    try {
      const result = await api.refreshCodexUsage(account.id);
      if (result.ok) {
        setLiveUsage(result);
        toast.success('用量数据已更新');
      } else {
        toast.error(`获取用量失败: ${result.error ?? 'unknown'}`);
      }
    } catch {
      toast.error('请求失败');
    } finally {
      setFetchingLive(false);
    }
  };

  useEffect(() => {
    fetchAuthInfo();
  }, [account.id, account.auth_file_path]);

  // 账号变为活跃时自动获取实时用量
  useEffect(() => {
    if (account.is_current) {
      handleRefreshLiveUsage();
    }
  }, [account.is_current]);

  const expiry = tokenExpiryInfo(authInfo?.token_expires_at);
  const hasAuthFile = authInfo && !authInfo.error;

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
          <span className="text-sm font-bold text-foreground">{account.account_id}</span>
          <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${tb.className}`}>{tb.label}</Badge>
          <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${sb.className}`}>{sb.label}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { fetchAuthInfo(); if (account.is_current) fetchCodexUsage(); }}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-secondary/50 text-muted-foreground"
            title="刷新账号信息"
          >
            <RefreshCw className={`h-3 w-3 ${loadingInfo || loadingCodexUsage ? 'animate-spin' : ''}`} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="h-6 w-6 flex items-center justify-center rounded hover:bg-secondary/50 text-muted-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={() => onSetActive(account.id)}>Set Active</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onPause(account.id)}>Pause</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onReset(account.id)}>Reset</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRemove(account.id)} className="text-destructive">Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 邮箱 + Auth 状态 */}
      <div className="mb-3">
        {loadingInfo ? (
          <p className="text-[11px] text-muted-foreground">读取账号信息...</p>
        ) : hasAuthFile ? (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
              <p className="text-[11px] text-foreground font-medium truncate max-w-[170px]">
                {showEmail
                  ? (authInfo.email ?? account.email)
                  : (authInfo.email ?? account.email ?? '').replace(/(.{2})[^@]+(@.{2})[^.]+(\..+)/, '$1***$2***$3')}
              </p>
              <button
                onClick={() => setShowEmail(v => !v)}
                className="h-4 w-4 flex items-center justify-center rounded hover:bg-secondary/50 text-muted-foreground shrink-0"
                title={showEmail ? '隐藏邮箱' : '显示邮箱'}
              >
                {showEmail ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
              </button>
            </div>
            {expiry && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                <p className={`text-[11px] ${expiry.color}`}>{expiry.label}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
            <p className="text-[11px] text-destructive">
              {authInfo?.error === 'auth_file_not_found'
                ? `Auth 文件不存在: ${authInfo.path}`
                : 'Auth 文件读取失败'}
            </p>
          </div>
        )}
      </div>

      {/* OpenAI 用量（5h / 周） */}
      {hasAuthFile && authInfo.usage && (
        <div className="space-y-1.5 mb-3 text-[11px]">
          {authInfo.usage.message_cap != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">5h 用量上限</span>
              <span className="text-foreground">{authInfo.usage.message_cap} 条</span>
            </div>
          )}
          {authInfo.usage.message_cap_rollover && (
            <div className="text-[10px] text-muted-foreground">
              重置时间：{new Date(authInfo.usage.message_cap_rollover).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}

      {/* Codex 用量（实时 API 数据） */}
      {(() => {
        const usage = liveUsage?.ok ? liveUsage : (codexUsage?.found ? codexUsage : null);
        const isLive = liveUsage?.ok;
        const primary = isLive ? liveUsage.primary : (codexUsage?.found ? codexUsage.primary : null);
        const secondary = isLive ? liveUsage.secondary : (codexUsage?.found ? codexUsage.secondary : null);
        const fetchedAt = isLive ? liveUsage.fetched_at : codexUsage?.recorded_at;

        return (
          <div className="mb-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Codex 用量</span>
              <div className="flex items-center gap-1.5">
                {fetchedAt && (
                  <span className="text-[9px] text-muted-foreground">
                    {isLive ? '实时 · ' : '旧数据 · '}
                    {formatDistanceToNow(new Date(fetchedAt), { addSuffix: true })}
                  </span>
                )}
                {account.is_current && (
                  <button
                    onClick={handleRefreshLiveUsage}
                    disabled={fetchingLive}
                    className="h-4 w-4 flex items-center justify-center rounded hover:bg-secondary/50 text-muted-foreground"
                    title="实时刷新用量（消耗极少 token）"
                  >
                    <RefreshCw className={`h-2.5 w-2.5 ${fetchingLive ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
            </div>

            {fetchingLive ? (
              <p className="text-[11px] text-muted-foreground">正在刷新...</p>
            ) : !primary && !secondary ? (
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">暂无数据</p>
                {account.is_current && (
                  <button
                    onClick={handleRefreshLiveUsage}
                    className="text-[10px] text-primary hover:underline"
                  >
                    点击获取实时数据
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {primary && (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">5小时窗口</span>
                      <span className={primary.used_percent >= 80 ? 'text-destructive font-medium' : primary.used_percent >= 50 ? 'text-warning font-medium' : 'text-foreground'}>
                        {primary.used_percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor(primary.used_percent)}`} style={{ width: `${Math.min(primary.used_percent, 100)}%` }} />
                    </div>
                    {primary.resets_at && (
                      <p className="text-[10px] text-muted-foreground">
                        重置：{new Date(primary.resets_at) < new Date() ? '已重置' : formatDistanceToNow(new Date(primary.resets_at), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                )}
                {secondary && (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">本周用量</span>
                      <span className={secondary.used_percent >= 80 ? 'text-destructive font-medium' : secondary.used_percent >= 50 ? 'text-warning font-medium' : 'text-foreground'}>
                        {secondary.used_percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor(secondary.used_percent)}`} style={{ width: `${Math.min(secondary.used_percent, 100)}%` }} />
                    </div>
                    {secondary.resets_at && (
                      <p className="text-[10px] text-muted-foreground">
                        重置：{new Date(secondary.resets_at) < new Date() ? '已重置' : formatDistanceToNow(new Date(secondary.resets_at), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* 用量检测区 */}
      <div className="mb-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-[11px] gap-1.5"
          onClick={handleCheckUsage}
          disabled={checkingUsage}
        >
          <Zap className={`h-3 w-3 ${checkingUsage ? 'animate-pulse' : ''}`} />
          {checkingUsage ? '检测中...' : '检测可用性'}
        </Button>

        {usageResult && (
          <div className={`mt-2 rounded-md px-3 py-2 text-[11px] space-y-1 ${
            usageResult.ok ? 'bg-primary/5 border border-primary/20' :
            usageResult.rate_limited ? 'bg-warning/10 border border-warning/20' :
            'bg-destructive/10 border border-destructive/20'
          }`}>
            {/* 状态行 */}
            <div className="flex items-center gap-1.5 font-medium">
              {usageResult.ok ? (
                <><CheckCircle2 className="h-3 w-3 text-primary" /><span className="text-primary">账号可用</span></>
              ) : usageResult.rate_limited ? (
                <><AlertCircle className="h-3 w-3 text-warning" /><span className="text-warning">已触发速率限制</span></>
              ) : usageResult.status === 401 ? (
                <><AlertCircle className="h-3 w-3 text-destructive" /><span className="text-destructive">Token 已失效</span></>
              ) : (
                <><AlertCircle className="h-3 w-3 text-destructive" /><span className="text-destructive">{usageResult.error ?? '检测失败'}</span></>
              )}
            </div>

            {/* Rate limit headers */}
            {usageResult.rate_limit && (
              <div className="space-y-0.5 text-muted-foreground">
                {usageResult.rate_limit.remaining_requests != null && (
                  <div className="flex justify-between">
                    <span>剩余请求数</span>
                    <span className={`font-medium ${
                      Number(usageResult.rate_limit.remaining_requests) === 0 ? 'text-destructive' :
                      Number(usageResult.rate_limit.remaining_requests) < 10 ? 'text-warning' : 'text-primary'
                    }`}>
                      {usageResult.rate_limit.remaining_requests}
                      {usageResult.rate_limit.limit_requests ? ` / ${usageResult.rate_limit.limit_requests}` : ''}
                    </span>
                  </div>
                )}
                {usageResult.rate_limit.reset_requests && (
                  <div className="flex justify-between">
                    <span>限额重置</span>
                    <span>{usageResult.rate_limit.reset_requests}</span>
                  </div>
                )}
                {usageResult.rate_limit.remaining_requests == null && usageResult.ok && (
                  <span className="text-[10px]">（OpenAI 未返回限额数据，但账号可正常使用）</span>
                )}
              </div>
            )}

            {usageResult.retry_after && (
              <div className="text-warning">冷却时间：{usageResult.retry_after}s</div>
            )}
          </div>
        )}
      </div>

      {/* 上次请求 */}
      <div className="flex gap-3 text-[10px] text-muted-foreground mb-3">
        <Tooltip>
          <TooltipTrigger>
            Last Req: {formatDistanceToNow(new Date(account.last_request_at), { addSuffix: true })}
          </TooltipTrigger>
          <TooltipContent className="text-xs">{new Date(account.last_request_at).toLocaleString()}</TooltipContent>
        </Tooltip>
        {authInfo?.last_refresh && (
          <Tooltip>
            <TooltipTrigger>
              Token 刷新: {formatDistanceToNow(new Date(authInfo.last_refresh), { addSuffix: true })}
            </TooltipTrigger>
            <TooltipContent className="text-xs">{new Date(authInfo.last_refresh).toLocaleString()}</TooltipContent>
          </Tooltip>
        )}
      </div>


      {/* Warning Banners */}
      {account.status === 'error' && (
        <div className="mt-3 -mx-4 -mb-4 px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-[11px] text-destructive">
          ⚠ 账号需要检查 — auth 状态异常
        </div>
      )}
      {account.status === 'rate_limited' && (
        <div className="mt-3 -mx-4 -mb-4 px-4 py-2 bg-warning/10 border-t border-warning/20 text-[11px] text-warning">
          ⚠ 已触发速率限制 — 冷却中
        </div>
      )}
      {hasAuthFile && expiry?.color === 'text-destructive' && account.status !== 'error' && (
        <div className="mt-3 -mx-4 -mb-4 px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-[11px] text-destructive">
          ⚠ {expiry.label}，请重新登录
        </div>
      )}
    </motion.div>
  );
}
