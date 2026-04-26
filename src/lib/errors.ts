export function formatAppError(error: unknown, fallback = '操作失败，请稍后重试'): string {
  const raw = (() => {
    if (error instanceof Error) return error.message || fallback;
    if (typeof error === 'string') return error;
    return fallback;
  })();

  if (!raw) return fallback;
  if (raw.includes('auth_file_not_found')) return 'Auth 文件不存在';
  if (raw.includes('invalid_auth_file')) return 'Auth 文件读取失败';
  if (raw.includes('no_access_token')) return '缺少 access token';
  if (raw.includes('token_invalid')) return 'Token 已失效，请重新登录';
  if (raw.includes('连接 chatgpt.com 超时') || raw.includes('UND_ERR_CONNECT_TIMEOUT')) return '网络超时，请检查本地代理是否可用';
  if (raw.includes('无法解析 chatgpt.com')) return '域名解析失败，请检查代理或 DNS 设置';
  if (raw.includes('连接被拒绝')) return '代理连接被拒绝，请确认本地代理已启动';
  if (raw.includes('连接被重置')) return '连接被重置，请检查当前代理线路';
  if (raw === 'Failed to fetch' || raw.includes('fetch failed')) return '网络请求失败，请检查后端服务或代理连接';
  if (raw.includes('ECONNREFUSED')) return '连接被拒绝，请确认后端服务已经启动';
  if (raw.includes('EADDRINUSE')) return '端口已被占用，请关闭已有服务后重试';
  return raw;
}
