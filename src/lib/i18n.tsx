import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { enUS, zhCN } from 'date-fns/locale';

export type Lang = 'en' | 'zh';

const dateFnsLocales = { en: enUS, zh: zhCN } as const;

const translations = {
  // ─── Header ───
  'app.title': { en: 'Codex Matrix', zh: 'Codex 矩阵' },
  'app.version': { en: 'v2.0', zh: 'v2.0' },
  'common.none': { en: 'None', zh: '无' },

  // ─── 404 ───
  'notFound.title': { en: '404', zh: '404' },
  'notFound.message': { en: 'Oops! Page not found', zh: '页面未找到' },
  'notFound.backHome': { en: 'Return to Home', zh: '返回首页' },

  // ─── Nav ───
  'nav.dashboard': { en: 'Dashboard', zh: '仪表盘' },
  'nav.tasks': { en: 'Task Queue', zh: '任务队列' },
  'nav.settings': { en: 'Settings', zh: '设置' },
  'nav.logs': { en: 'Logs', zh: '日志' },

  // ─── Left Sidebar ───
  'sidebar.currentActive': { en: 'Currently Active', zh: '当前激活' },
  'sidebar.cliCurrent': { en: 'CLI Current Auth', zh: 'CLI 当前账号' },
  'sidebar.cliOauthCurrent': { en: 'CLI OAuth Auth', zh: 'CLI 当前 OAuth 账号' },
  'sidebar.cliApiCurrent': { en: 'CLI Current API Relay', zh: 'CLI 当前 API 中转站' },
  'sidebar.cliNoAuth': { en: 'CLI auth not found', zh: '未检测到 CLI 登录信息' },
  'sidebar.cliPath': { en: 'Auth Path', zh: '认证路径' },
  'sidebar.noActive': { en: 'No active account', zh: '暂无激活账号' },
  'sidebar.noActiveHint': { en: 'Click ··· → Set Active on a card', zh: '点账号卡片的 ··· → Set Active' },
  'sidebar.provider.api': { en: 'API relay', zh: 'API 中转站' },
  'sidebar.provider.oauth': { en: 'OAuth auth', zh: 'OAuth 登录' },
  'sidebar.cliUnaffectedByApi': { en: 'API mode does not overwrite CLI auth.json', zh: 'API 模式不会改写 CLI 的 auth.json' },
  'sidebar.cliModel': { en: 'CLI Model', zh: 'CLI 模型' },
  'sidebar.cliBaseUrl': { en: 'CLI Base URL', zh: 'CLI 地址' },
  'sidebar.cliManagedOk': { en: 'CLI relay takeover active', zh: 'CLI 中转站接管已生效' },
  'sidebar.cliManagedMismatch': { en: 'CLI relay takeover not active', zh: 'CLI 中转站接管未生效' },
  'sidebar.recentOps': { en: 'Recent Operations', zh: '最近操作' },
  'sidebar.noLogs': { en: 'No operations yet', zh: '暂无操作记录' },

  // ─── Right Sidebar ───
  'right.quickActions': { en: 'Quick Actions', zh: '快捷操作' },
  'right.rotateNext': { en: 'Rotate to Next Account', zh: '立即切换下一个账号' },
  'right.pauseAll': { en: 'Pause All Accounts', zh: '暂停所有账号' },
  'right.healthCheck': { en: 'Health Check All', zh: '全部健康检查' },
  'right.reloadOpenClaw': { en: 'Reload OpenClaw', zh: '重载 OpenClaw' },
  'right.refreshAllTokens': { en: 'Refresh All Tokens', zh: '批量刷新 Token' },
  'right.rotationSettings': { en: 'Rotation Settings', zh: '轮换设置' },
  'right.strategy': { en: 'Strategy', zh: '切换策略' },
  'right.strategy.round_robin': { en: 'Round Robin', zh: 'Round Robin' },
  'right.strategy.least_used': { en: 'Least Used (Recommended)', zh: 'Least Used（推荐）' },
  'right.strategy.random': { en: 'Random', zh: 'Random' },
  'right.strategy.priority_based': { en: 'Priority Based', zh: 'Priority Based' },
  'right.strategyHint': { en: 'Controls which account is selected during rotation. Least Used is usually the safest default.', zh: '决定切换时优先选哪个账号。一般用 Least Used 最稳。' },
  'right.autoRotation': { en: 'Auto-Rotation', zh: '自动轮换' },
  'right.autoRotationHint': { en: 'Checks the active account periodically and rotates automatically when 5-hour usage reaches 90%.', zh: '定期检查当前活跃账号；5 小时用量达到 90% 时会自动切换。' },
  'right.autoTokenRefresh': { en: 'Auto Token Refresh', zh: '自动刷新 Token' },
  'right.autoTokenRefreshHint': { en: 'Only applies to OAuth accounts. API relay accounts are not refreshed here.', zh: '只对 OAuth 账号生效，API 中转站账号不会在这里刷新。' },
  'right.refreshInterval': { en: 'Refresh interval (hours)', zh: '刷新间隔（小时）' },
  'right.refreshIntervalHint': { en: 'The backend refreshes all OAuth tokens on this schedule.', zh: '后端会按这个间隔批量刷新所有 OAuth 账号的 Token。' },
  'right.codexConfig': { en: 'Codex Config', zh: 'Codex 配置' },
  'right.codexPath': { en: 'Codex executable path', zh: 'Codex 可执行文件路径' },
  'right.codexPathHint': { en: 'Leave empty to auto-detect from PATH. Set it only when the binary cannot be found.', zh: '留空会自动从 PATH 探测。只有找不到 codex 时才需要手填。' },
  'right.openclawIntegration': { en: 'OpenClaw Integration', zh: 'OpenClaw 集成' },
  'right.openclawOptional': { en: 'Optional integration', zh: '可选集成' },
  'right.openclawHint': { en: 'Only relevant if you use OpenClaw alongside account rotation. Otherwise you can ignore this section.', zh: '只有在你同时使用 OpenClaw 和账号轮换时才有意义；否则可以忽略这块。' },
  'right.openclawAdvanced': { en: 'Advanced / reserved fields', zh: '高级 / 预留字段' },
  'right.openclawAdvancedHint': { en: 'These values are currently stored for future integration and do not meaningfully affect runtime behavior.', zh: '这些字段目前主要用于保存配置，对当前运行逻辑基本没有直接影响。' },
  'right.endpoint': { en: 'Endpoint', zh: 'Endpoint' },
  'right.apiKey': { en: 'API Key', zh: 'API Key' },
  'right.autoDispatch': { en: 'Auto-dispatch tasks', zh: '自动分发任务' },

  // ─── Filter Bar ───
  'filter.active': { en: 'Active', zh: '活跃' },
  'filter.total': { en: 'Total', zh: '总计' },
  'filter.search': { en: 'Search profiles...', zh: '搜索账号...' },
  'filter.refresh': { en: 'Refresh Pool', zh: '刷新池' },
  'filter.clearAll': { en: 'Clear All', zh: '清空全部' },
  'filter.clearing': { en: 'Clearing...', zh: '清空中...' },

  // ─── Account Card ───
  'card.refreshInfo': { en: 'Refresh account info', zh: '刷新账号信息' },
  'card.readingInfo': { en: 'Reading account info...', zh: '读取账号信息...' },
  'card.showEmail': { en: 'Show email', zh: '显示邮箱' },
  'card.hideEmail': { en: 'Hide email', zh: '隐藏邮箱' },
  'card.tokenExpired': { en: 'Access token expired', zh: 'Access Token 已过期' },
  'card.tokenDaysLeft': { en: 'Access token: {days} days left', zh: 'Access Token 还剩 {days} 天' },
  'card.tokenHoursLeft': { en: 'Access token: {hours} hours left', zh: 'Access Token 还剩 {hours} 小时' },
  'card.planExpired': { en: 'Plan expired', zh: '套餐已过期' },
  'card.planDaysLeft': { en: 'Plan: {days} days left', zh: '套餐还剩 {days} 天' },
  'card.planHoursLeft': { en: 'Plan: {hours} hours left', zh: '套餐还剩 {hours} 小时' },
  'card.expiresOn': { en: 'Expires on {date}', zh: '到期 {date}' },
  'card.authNotFound': { en: 'Auth file not found', zh: 'Auth 文件不存在' },
  'card.authReadFail': { en: 'Auth file read failed', zh: 'Auth 文件读取失败' },
  'card.noAuth': { en: 'No auth', zh: '未授权' },
  'card.apiBaseUrl': { en: 'API Base URL', zh: '中转站地址' },
  'card.apiModel': { en: 'API Model', zh: '模型' },
  'card.provider.api': { en: 'API', zh: 'API' },
  'card.provider.oauth': { en: 'OAuth', zh: 'OAuth' },
  'card.5hUsageCap': { en: '5h usage cap', zh: '5h 用量上限' },
  'card.resetTime': { en: 'Reset time', zh: '重置时间' },
  'card.codexUsage': { en: 'Codex Usage', zh: 'Codex 用量' },
  'card.live': { en: 'Live', zh: '实时' },
  'card.stale': { en: 'Stale', zh: '旧数据' },
  'card.refreshLive': { en: 'Refresh live usage (minimal tokens)', zh: '实时刷新用量（消耗极少 token）' },
  'card.refreshing': { en: 'Refreshing...', zh: '正在刷新...' },
  'card.apiChecking': { en: 'Checking relay...', zh: '正在检测中转站...' },
  'card.noData': { en: 'No data', zh: '暂无数据' },
  'card.clickToFetch': { en: 'Click to fetch live data', zh: '点击获取实时数据' },
  'card.apiClickToCheck': { en: 'Click to check relay', zh: '点击检测中转站连通性' },
  'card.5hWindow': { en: '5-hour window', zh: '5小时窗口' },
  'card.weeklyUsage': { en: 'Weekly usage', zh: '本周用量' },
  'card.resetDone': { en: 'Reset', zh: '已重置' },
  'card.checkAvailability': { en: 'Check Availability & Refresh', zh: '检测可用性 & 刷新用量' },
  'card.checkRelay': { en: 'Check Relay Connectivity', zh: '检测中转站连通性' },
  'card.checking': { en: 'Checking...', zh: '检测中...' },
  'card.menuSetActive': { en: 'Set Active', zh: '设为当前账号' },
  'card.menuPause': { en: 'Pause', zh: '暂停' },
  'card.menuReset': { en: 'Reset', zh: '重置' },
  'card.menuRefreshToken': { en: 'Refresh Token', zh: '刷新 Token' },
  'card.menuEditCliConfig': { en: 'Edit CLI Config', zh: '编辑 CLI 配置' },
  'card.menuRemove': { en: 'Remove', zh: '删除' },
  'card.refreshTokenSuccess': { en: 'Token refreshed', zh: 'Token 刷新成功' },
  'card.refreshTokenFailed': { en: 'Token refresh failed', zh: 'Token 刷新失败' },
  'card.codexAvailable': { en: 'Codex Available', zh: 'Codex 可用' },
  'card.codexRateLimited': { en: 'Codex Rate Limited', zh: 'Codex 已限额' },
  'card.tokenInvalid': { en: 'Token Invalid', zh: 'Token 已失效' },
  'card.checkFailed': { en: 'Check failed', zh: '检测失败' },
  'card.noAccessToken': { en: 'No access token', zh: '缺少 access token' },
  'card.proxyTimeout': { en: 'Network timeout, check proxy', zh: '网络超时，请检查代理是否可用' },
  'card.proxyDnsError': { en: 'DNS failed, check proxy/DNS', zh: '域名解析失败，请检查代理或 DNS' },
  'card.proxyRefused': { en: 'Proxy connection refused', zh: '代理连接被拒绝，请确认本地代理已启动' },
  'card.proxyReset': { en: 'Proxy connection reset', zh: '代理连接被重置，请检查代理线路' },
  'card.apiBaseUrlMissing': { en: 'Missing API base URL', zh: '缺少中转站地址' },
  'card.apiKeyMissing': { en: 'Missing API key', zh: '缺少 API Key' },
  'card.apiModelNotFound': { en: 'Configured model not found', zh: '配置的模型不存在' },
  'card.apiRelayTimeout': { en: 'Relay timeout', zh: '中转站连接超时' },
  'card.apiRelayOk': { en: 'Relay reachable', zh: '中转站连通成功' },
  'card.apiRelayUsage': { en: 'Relay Status', zh: '中转站状态' },
  'card.apiModelStatus': { en: 'Model check', zh: '模型检查' },
  'card.apiModelReachable': { en: 'Configured model available', zh: '配置模型可用' },
  'card.apiModelUnavailable': { en: 'Configured model unavailable', zh: '配置模型不可用' },
  'card.apiModelCount': { en: 'Models returned', zh: '返回模型数' },
  'card.apiCliConfig': { en: 'CLI Config Snippet', zh: 'CLI 配置片段' },
  'card.apiCliConfigEmpty': { en: 'No custom CLI config', zh: '未配置自定义 CLI 片段' },
  'card.apiCliConfigSummary': { en: '{lines} lines configured', zh: '已配置 {lines} 行' },
  'card.apiCliConfigPreview': { en: 'Final Write Preview', zh: '最终写入预览' },
  'card.apiCliConfigSaved': { en: 'CLI config saved', zh: 'CLI 配置已保存' },
  'card.apiCliConfigSaveFailed': { en: 'CLI config save failed', zh: 'CLI 配置保存失败' },
  'card.apiGroup.team': { en: 'Advanced Group', zh: '高级组' },
  'card.apiGroup.plus': { en: 'Standard Group', zh: '标准组' },
  'card.apiGroup.free': { en: 'Basic Group', zh: '基础组' },
  'card.lastReq': { en: 'Last Req', zh: '上次请求' },
  'card.tokenRefresh': { en: 'Token Refresh', zh: 'Token 刷新' },
  'card.errorWarning': { en: 'Account needs attention — auth issue', zh: '账号需要检查 — auth 状态异常' },
  'card.rateLimitWarning': { en: 'Rate limited — cooling down', zh: '已触发速率限制 — 冷却中' },
  'card.tokenExpireWarning': { en: ', please re-login', zh: '，请重新登录' },
  'card.addAccount': { en: 'Add Account', zh: '添加账号' },

  // ─── Add Account Dialog ───
  'addAccount.title': { en: 'Add OpenAI Account', zh: '添加 OpenAI 账号' },
  'addAccount.name': { en: 'Account Name', zh: '账号名称' },
  'addAccount.namePlaceholder': { en: 'e.g. myaccount1', zh: '例如：myaccount1' },
  'addAccount.nameRequired': { en: 'Account name is required', zh: '请输入账号名称' },
  'addAccount.email': { en: 'OpenAI Email', zh: 'OpenAI 邮箱' },
  'addAccount.emailInvalid': { en: 'Invalid email format', zh: '邮箱格式不正确' },
  'addAccount.emailRequired': { en: 'Email is required', zh: '请输入邮箱' },
  'addAccount.type': { en: 'Account Type', zh: '账号类型' },
  'addAccount.authPath': { en: 'Auth File Path', zh: 'Auth 文件路径' },
  'addAccount.authPathRequired': { en: 'Auth file path is required', zh: '请输入 auth 文件路径' },
  'addAccount.authHint': { en: 'Login with codex login first, auth files are auto-generated', zh: '先用 codex login 登录各账号，auth 文件会自动生成' },
  'addAccount.apiGroup': { en: 'Account Group', zh: '账号分组' },
  'addAccount.apiGroupHint': { en: 'Only used as a grouping label for relay accounts', zh: '仅作为中转站账号的分组标签' },
  'addAccount.apiCategory': { en: 'Category', zh: '分类' },
  'addAccount.apiCliConfig': { en: 'CLI Config Snippet', zh: 'CLI 配置片段' },
  'addAccount.apiCliConfigHint': { en: 'Provider TOML lines only. base_url is managed separately.', zh: '只填写 provider 内的 TOML 行，base_url 会单独管理。' },
  'addAccount.cancel': { en: 'Cancel', zh: '取消' },
  'addAccount.submit': { en: 'Add Account', zh: '添加账号' },
  'addAccount.submitting': { en: 'Adding...', zh: '添加中...' },
  'addAccount.success': { en: 'Account {name} added', zh: '账号 {name} 添加成功' },

  // ─── Settings page ───
  'settings.title': { en: 'Settings', zh: '设置' },
  'settings.global': { en: 'Global Settings', zh: '全局设置' },
  'settings.maxConcurrent': { en: 'Max concurrent tasks', zh: '最大并发任务数' },
  'settings.globalRateLimit': { en: 'Global rate limit (req/min)', zh: '全局速率限制 (请求/分钟)' },
  'settings.taskTimeout': { en: 'Task timeout (minutes)', zh: '任务超时 (分钟)' },
  'settings.maxRetries': { en: 'Max retries', zh: '最大重试次数' },
  'settings.autoRetry': { en: 'Auto-retry failed tasks', zh: '自动重试失败任务' },
  'settings.notifications': { en: 'Notifications', zh: '通知' },
  'settings.importExport': { en: 'Import / Export', zh: '导入 / 导出' },
  'settings.dangerZone': { en: 'Danger Zone', zh: '危险区域' },

  // ─── Logs page ───
  'logs.title': { en: 'Logs', zh: '日志' },
  'logs.allLevels': { en: 'All Levels', zh: '全部级别' },
  'logs.allAccounts': { en: 'All Accounts', zh: '全部账号' },
  'logs.autoScroll': { en: 'Auto-scroll', zh: '自动滚动' },
  'logs.clear': { en: 'Clear', zh: '清空' },
  'logs.export': { en: 'Export', zh: '导出' },
  'logs.empty': { en: 'No logs matching filters.', zh: '没有匹配的日志。' },

  // ─── Tasks page ───
  'tasks.title': { en: 'Task Queue', zh: '任务队列' },
  'tasks.addTask': { en: 'Add Task', zh: '添加任务' },
  'tasks.description': { en: 'Description', zh: '描述' },
  'tasks.priority': { en: 'Priority', zh: '优先级' },
  'tasks.account': { en: 'Account', zh: '账号' },
  'tasks.autoAssign': { en: 'Auto-assign', zh: '自动分配' },
  'tasks.create': { en: 'Create Task', zh: '创建任务' },
  'tasks.cancel': { en: 'Cancel', zh: '取消' },
  'tasks.retry': { en: 'Retry', zh: '重试' },
  'tasks.status': { en: 'Status', zh: '状态' },
  'tasks.created': { en: 'Created', zh: '创建时间' },
  'tasks.result': { en: 'Result', zh: '结果' },

  // ─── Loading states ───
  'loading.dashboard': { en: 'Loading dashboard...', zh: '加载仪表盘...' },
  'loading.tasks': { en: 'Loading tasks...', zh: '加载任务...' },
  'loading.settings': { en: 'Loading settings...', zh: '加载设置...' },
  'loading.logs': { en: 'Loading logs...', zh: '加载日志...' },

  // ─── Toast messages ───
  'toast.accountActive': { en: 'Account set as active', zh: '账号已设为当前活跃' },
  'toast.accountPaused': { en: 'Account paused', zh: '账号已暂停' },
  'toast.accountReset': { en: 'Account reset', zh: '账号已重置' },
  'toast.accountRemoved': { en: 'Account removed', zh: '账号已删除' },
  'toast.allCleared': { en: 'All accounts cleared', zh: '已清空所有账号' },
  'toast.noAccountsToClear': { en: 'No accounts to clear', zh: '没有账号可以清空' },
  'toast.confirmClear': { en: 'Are you sure you want to delete all {count} accounts? This cannot be undone.', zh: '确定要删除全部 {count} 个账号吗？此操作不可撤销。' },
  'toast.poolRefreshed': { en: 'Pool refreshed', zh: '池已刷新' },
} as const;

type TranslationKey = keyof typeof translations;

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  dateLocale: Locale;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem('cpm-lang');
    if (saved === 'en' || saved === 'zh') return saved;
    return navigator.language.startsWith('zh') ? 'zh' : 'en';
  });

  const handleSetLang = useCallback((newLang: Lang) => {
    setLang(newLang);
    localStorage.setItem('cpm-lang', newLang);
  }, []);

  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>): string => {
    const entry = translations[key];
    if (!entry) return key;
    let text = entry[lang] || entry.en;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  }, [lang]);

  const dateLocale = useMemo(() => dateFnsLocales[lang], [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang: handleSetLang, t, dateLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
