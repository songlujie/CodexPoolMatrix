import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import httpProxyAgentPkg from 'http-proxy-agent';
import httpsProxyAgentPkg from 'https-proxy-agent';
import { config } from './config.js';
import { initDatabase } from './init-db.js';
import { pool } from './db.js';

const { HttpProxyAgent } = httpProxyAgentPkg;
const { HttpsProxyAgent } = httpsProxyAgentPkg;

// 项目根目录（server/ 的上一层）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
// 项目内置账号目录，优先作为默认扫描路径
const PROJECT_ACCOUNTS_DIR = path.join(PROJECT_ROOT, 'accounts');

const execAsync = promisify(exec);

function stripAnsi(text = '') {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function shouldUseShellForBinary(command) {
  if (process.platform !== 'win32') {
    return false;
  }

  return !path.isAbsolute(command) || /\.(cmd|bat)$/i.test(command);
}

function isWindowsStoreBinary(command) {
  return /\\WindowsApps\\/i.test(command);
}

function getCodexCommandEnv() {
  return { ...process.env, TERM: 'xterm' };
}

function isApiAccount(account = {}) {
  return account.provider_mode === 'api';
}

function normalizeApiBaseUrl(baseUrl = '') {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

const proxyAgentCache = new Map();

function shouldBypassProxy(hostname) {
  const rules = String(config.proxy.noProxy || '')
    .split(',')
    .map(rule => rule.trim().toLowerCase())
    .filter(Boolean);

  const target = hostname.toLowerCase();
  return rules.some((rule) => {
    if (rule === '*') return true;
    if (rule === target) return true;
    if (rule.startsWith('.')) return target.endsWith(rule);
    return target.endsWith(`.${rule}`);
  });
}

function getProxyAgent(url) {
  if (shouldBypassProxy(url.hostname)) {
    return undefined;
  }

  const proxyUrl = url.protocol === 'https:'
    ? (config.proxy.https || config.proxy.http)
    : config.proxy.http;

  if (!proxyUrl) {
    return undefined;
  }

  const cacheKey = `${url.protocol}:${proxyUrl}`;
  if (!proxyAgentCache.has(cacheKey)) {
    proxyAgentCache.set(
      cacheKey,
      url.protocol === 'https:'
        ? new HttpsProxyAgent(proxyUrl)
        : new HttpProxyAgent(proxyUrl),
    );
  }

  return proxyAgentCache.get(cacheKey);
}

async function requestJson(urlString, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 15000,
} = {}) {
  const url = new URL(urlString);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers,
      agent: getProxyAgent(url),
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = null;
        }

        resolve({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          status: res.statusCode || 0,
          headers: res.headers,
          text: raw,
          json,
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      const error = new Error('Request timeout');
      error.name = 'TimeoutError';
      req.destroy(error);
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

function buildRelayUrl(baseUrl, resourcePath) {
  return new URL(resourcePath.replace(/^\//, ''), normalizeApiBaseUrl(baseUrl)).toString();
}

const CODEX_HOME_DIR = path.join(os.homedir(), '.codex');
const CODEX_CONFIG_PATH = path.join(CODEX_HOME_DIR, 'config.toml');
const CODEX_AUTH_PATH = path.join(CODEX_HOME_DIR, 'auth.json');
const CODEX_MATRIX_STATE_PATH = path.join(CODEX_HOME_DIR, 'matrix-cli-state.json');
const CODEX_MATRIX_PROVIDER = 'custom';
const CODEX_MATRIX_MANAGED_START = '# >>> CODEX MATRIX MANAGED START';
const CODEX_MATRIX_MANAGED_END = '# <<< CODEX MATRIX MANAGED END';

function tomlString(value = '') {
  return JSON.stringify(String(value ?? ''));
}

function normalizeCodexConfigBaseUrl(baseUrl = '') {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function sanitizeApiCliConfigSnippet(snippet = '') {
  const lines = String(snippet || '').split(/\r?\n/);
  const seenKeys = new Set();
  const kept = [];

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      kept.push(line);
      continue;
    }

    if (trimmed.startsWith('#')) {
      kept.push(line);
      continue;
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (/^\[model_providers\./.test(trimmed)) {
        continue;
      }
      kept.push(line);
      continue;
    }

    if (/^base_url\s*=/.test(trimmed)) {
      continue;
    }

    const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/);
    if (!keyMatch) {
      kept.push(line);
      continue;
    }

    const key = keyMatch[1];
    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    kept.push(line);
  }

  return kept
    .reverse()
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function snippetHasTomlKey(snippet = '', key) {
  const pattern = new RegExp(`^${key}\\s*=`, 'm');
  return pattern.test(String(snippet || ''));
}

function splitTomlRootAndTail(content = '') {
  const firstTableMatch = content.match(/^\s*\[[^\]]+\]\s*$/m);
  if (!firstTableMatch || firstTableMatch.index == null) {
    return { root: content, tail: '' };
  }

  return {
    root: content.slice(0, firstTableMatch.index),
    tail: content.slice(firstTableMatch.index),
  };
}

function readTopLevelTomlString(content = '', key) {
  const { root } = splitTomlRootAndTail(content);
  const match = root.match(new RegExp(`^${key}\\s*=\\s*("([^"\\\\]|\\\\.)*"|'([^'\\\\]|\\\\.)*')\\s*$`, 'm'));
  if (!match) return undefined;

  const raw = match[1];
  try {
    return JSON.parse(raw.replace(/^'/, '"').replace(/'$/, '"'));
  } catch {
    return raw.slice(1, -1);
  }
}

function upsertTopLevelTomlString(content = '', key, value) {
  const { root, tail } = splitTomlRootAndTail(content);
  const line = `${key} = ${tomlString(value)}`;
  const pattern = new RegExp(`^${key}\\s*=.*$`, 'm');
  let nextRoot;

  if (pattern.test(root)) {
    nextRoot = root.replace(pattern, line);
  } else {
    nextRoot = `${root.trimEnd()}\n${line}\n`;
  }

  return `${nextRoot.replace(/^\n+/, '')}${tail ? (nextRoot.endsWith('\n') ? '' : '\n') + tail.replace(/^\n+/, '') : ''}`;
}

function upsertTopLevelTomlLiteral(content = '', key, literal) {
  const { root, tail } = splitTomlRootAndTail(content);
  const line = `${key} = ${literal}`;
  const pattern = new RegExp(`^${key}\\s*=.*$`, 'm');
  let nextRoot;

  if (pattern.test(root)) {
    nextRoot = root.replace(pattern, line);
  } else {
    nextRoot = `${root.trimEnd()}\n${line}\n`;
  }

  return `${nextRoot.replace(/^\n+/, '')}${tail ? (nextRoot.endsWith('\n') ? '' : '\n') + tail.replace(/^\n+/, '') : ''}`;
}

function removeTopLevelTomlKey(content = '', key) {
  const { root, tail } = splitTomlRootAndTail(content);
  const pattern = new RegExp(`^${key}\\s*=.*(?:\\r?\\n)?`, 'm');
  const nextRoot = root.replace(pattern, '').replace(/\n{3,}/g, '\n\n');
  return `${nextRoot}${tail}`;
}

function stripManagedCodexConfigBlock(content = '') {
  const startIndex = content.indexOf(CODEX_MATRIX_MANAGED_START);
  const endIndex = content.indexOf(CODEX_MATRIX_MANAGED_END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return content;
  }

  const endOffset = endIndex + CODEX_MATRIX_MANAGED_END.length;
  return `${content.slice(0, startIndex).trimEnd()}\n${content.slice(endOffset).replace(/^\s+/, '')}`.trim() + '\n';
}

function buildManagedCodexProviderBlock(account) {
  const baseUrl = normalizeCodexConfigBaseUrl(account.api_base_url);
  const customConfig = sanitizeApiCliConfigSnippet(account.api_cli_config);

  const lines = [
    CODEX_MATRIX_MANAGED_START,
    `# account_id = ${account.account_id}`,
    `[model_providers.${CODEX_MATRIX_PROVIDER}]`,
    `base_url = ${tomlString(baseUrl)}`,
  ];

  if (!snippetHasTomlKey(customConfig, 'name')) {
    lines.push(`name = ${tomlString('custom')}`);
  }
  if (!snippetHasTomlKey(customConfig, 'wire_api')) {
    lines.push('wire_api = "responses"');
  }

  if (customConfig) {
    lines.push(...customConfig.split('\n'));
  }

  lines.push(CODEX_MATRIX_MANAGED_END, '');
  return lines.join('\n');
}

async function readCodexMatrixState() {
  try {
    const raw = await fs.readFile(CODEX_MATRIX_STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCodexMatrixState(payload) {
  await fs.mkdir(CODEX_HOME_DIR, { recursive: true });
  await fs.writeFile(CODEX_MATRIX_STATE_PATH, JSON.stringify(payload, null, 2));
}

async function removeCodexMatrixState() {
  try {
    await fs.unlink(CODEX_MATRIX_STATE_PATH);
  } catch {
    // ignore missing state file
  }
}

async function readCodexConfigText() {
  try {
    return await fs.readFile(CODEX_CONFIG_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function readCodexAuthText() {
  try {
    return await fs.readFile(CODEX_AUTH_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeCodexApiKeyAuth(apiKey) {
  await fs.mkdir(CODEX_HOME_DIR, { recursive: true });
  await fs.writeFile(CODEX_AUTH_PATH, JSON.stringify({
    OPENAI_API_KEY: String(apiKey || '').trim() || '',
  }, null, 2));
}

function detectCodexManagedProvider(configText = '') {
  const provider = readTopLevelTomlString(configText, 'model_provider') || null;
  const model = readTopLevelTomlString(configText, 'model') || null;
  const hasManagedBlock = configText.includes(CODEX_MATRIX_MANAGED_START) && configText.includes(CODEX_MATRIX_MANAGED_END);
  const providerBlockPattern = new RegExp(`\\[model_providers\\.${CODEX_MATRIX_PROVIDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`);

  return {
    managed: provider === CODEX_MATRIX_PROVIDER && hasManagedBlock && providerBlockPattern.test(configText),
    provider,
    model,
    hasManagedBlock,
  };
}

async function activateCodexApiProvider(account) {
  const currentConfig = await readCodexConfigText();
  const currentAuthText = await readCodexAuthText();
  const cleanConfig = stripManagedCodexConfigBlock(currentConfig);
  const existingState = await readCodexMatrixState();
  const previousConfig = existingState?.previous || {
    model: readTopLevelTomlString(cleanConfig, 'model') ?? null,
    model_provider: readTopLevelTomlString(cleanConfig, 'model_provider') ?? null,
    auth_json: currentAuthText,
  };

  let nextConfig = cleanConfig;
  nextConfig = upsertTopLevelTomlString(nextConfig, 'model_provider', CODEX_MATRIX_PROVIDER);
  nextConfig = upsertTopLevelTomlString(nextConfig, 'model', String(account.api_model || '').trim() || previousConfig.model || 'gpt-5.4');
  nextConfig = upsertTopLevelTomlString(nextConfig, 'model_reasoning_effort', 'medium');
  nextConfig = upsertTopLevelTomlLiteral(nextConfig, 'disable_response_storage', 'true');
  nextConfig = `${nextConfig.trimEnd()}\n\n${buildManagedCodexProviderBlock(account)}`;

  await fs.mkdir(CODEX_HOME_DIR, { recursive: true });
  await fs.writeFile(CODEX_CONFIG_PATH, `${nextConfig.trimEnd()}\n`);
  await writeCodexApiKeyAuth(account.api_key);
  await writeCodexMatrixState({
    mode: 'api',
    account_id: account.account_id,
    email: account.email || null,
    api_base_url: normalizeCodexConfigBaseUrl(account.api_base_url),
    api_model: String(account.api_model || '').trim() || null,
    api_cli_config: sanitizeApiCliConfigSnippet(account.api_cli_config) || null,
    previous: previousConfig,
  });
}

async function restoreCodexOAuthProvider() {
  const currentConfig = await readCodexConfigText();
  const cleanConfig = stripManagedCodexConfigBlock(currentConfig);
  const state = await readCodexMatrixState();
  const previous = state?.previous || {};

  let nextConfig = cleanConfig;
  if (previous.model_provider) {
    nextConfig = upsertTopLevelTomlString(nextConfig, 'model_provider', previous.model_provider);
  } else {
    nextConfig = removeTopLevelTomlKey(nextConfig, 'model_provider');
  }

  if (previous.model) {
    nextConfig = upsertTopLevelTomlString(nextConfig, 'model', previous.model);
  } else {
    nextConfig = removeTopLevelTomlKey(nextConfig, 'model');
  }

  await fs.mkdir(CODEX_HOME_DIR, { recursive: true });
  await fs.writeFile(CODEX_CONFIG_PATH, `${nextConfig.trimEnd()}\n`);
  if (typeof previous.auth_json === 'string') {
    await fs.writeFile(CODEX_AUTH_PATH, previous.auth_json);
  }
  await removeCodexMatrixState();
}

function formatCodexProbeSummary(failures) {
  return failures
    .map(({ command, reason }) => `${command}: ${reason}`)
    .join('\n');
}

function getCodexUnavailableMessage(failures) {
  if (
    process.platform === 'win32' &&
    failures.some(({ command, reason }) => isWindowsStoreBinary(command) || /access is denied|拒绝访问|eperm/i.test(reason))
  ) {
    return '未找到可执行的 Codex CLI。当前探测到的 Windows Store 版 codex.exe 在此环境下无法被后端调用，请安装可执行的 Codex CLI，或在设置中把 Codex 路径改成可运行的 codex.cmd/.bat/.exe。';
  }

  return '未找到可执行的 Codex CLI，请在设置中填写正确的 Codex 路径。';
}

async function probeCodexCandidate(command) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: shouldUseShellForBinary(command),
        windowsHide: true,
        env: getCodexCommandEnv(),
      });
    } catch (error) {
      resolve({
        ok: false,
        reason: error.message,
        output: '',
        code: error.code || null,
      });
      return;
    }

    let output = '';
    const appendOutput = (chunk) => {
      output += stripAnsi(chunk.toString());
    };

    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);

    child.on('error', (error) => {
      resolve({
        ok: false,
        reason: error.message,
        output,
        code: error.code || null,
      });
    });

    child.on('exit', (code) => {
      resolve({
        ok: code === 0,
        reason: code === 0 ? null : output.trim() || `exit ${code}`,
        output,
        code,
      });
    });
  });
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/**
 * 包装 async 路由，自动捕获异常交给 Express error handler
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * 展开路径中的 ~ 为用户主目录
 */
function expandPath(filePath) {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * 解码 JWT payload（不验证签名，只读取数据）
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function getAuthIdentity(authData = {}) {
  const accessToken = authData?.tokens?.access_token || authData?.access_token || authData?.accessToken || '';
  const payload = accessToken ? decodeJwtPayload(accessToken) : null;
  const profile = payload?.['https://api.openai.com/profile'];
  const auth = payload?.['https://api.openai.com/auth'];

  return {
    accessToken,
    payload,
    email: String(payload?.email || profile?.email || authData?.email || '').trim().toLowerCase(),
    accountId: String(auth?.chatgpt_account_id || authData?.account_id || '').trim(),
    subject: String(payload?.sub || '').trim(),
  };
}

function sanitizeAuthFilePart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/@/g, '_at_')
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120);
}

function buildAuthStorageFileName(authData, fallbackName = 'auth.json') {
  const identity = getAuthIdentity(authData);
  const fallbackBase = path.basename(fallbackName, path.extname(fallbackName));
  const preferredBase =
    sanitizeAuthFilePart(identity.email) ||
    sanitizeAuthFilePart(identity.accountId) ||
    sanitizeAuthFilePart(identity.subject) ||
    sanitizeAuthFilePart(fallbackBase);

  const safeBase = preferredBase || `auth_${Date.now()}`;
  return {
    identity,
    fileName: `${safeBase === 'auth' ? `auth_${Date.now()}` : safeBase}.json`,
  };
}

function looksLikeAuthFile(authData = {}) {
  const identity = getAuthIdentity(authData);
  return Boolean(
    identity.accessToken ||
    authData?.tokens?.refresh_token ||
    authData?.refresh_token ||
    authData?.OPENAI_API_KEY
  );
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function saveAuthFileToAccounts(authFilePath, originalFileName = path.basename(authFilePath)) {
  const authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
  const { fileName, identity } = buildAuthStorageFileName(authData, originalFileName);
  const dest = path.join(PROJECT_ACCOUNTS_DIR, fileName);

  await fs.mkdir(PROJECT_ACCOUNTS_DIR, { recursive: true });
  await fs.copyFile(authFilePath, dest);

  return { fileName, dest, identity };
}

async function findLatestChangedAuthFile(codexDir, beforeFiles = new Set()) {
  const afterFiles = await fs.readdir(codexDir);
  const changedJsonFiles = [];

  for (const file of afterFiles) {
    if (!file.endsWith('.json')) continue;
    const fullPath = path.join(codexDir, file);
    const stat = await fs.stat(fullPath);
    if (beforeFiles.has(`${file}::${stat.mtimeMs}`)) continue;

    try {
      const authData = JSON.parse(await fs.readFile(fullPath, 'utf8'));
      if (!looksLikeAuthFile(authData) && file !== 'auth.json') continue;
      changedJsonFiles.push({ fileName: file, fullPath, mtimeMs: stat.mtimeMs });
    } catch {
      if (file === 'auth.json') {
        changedJsonFiles.push({ fileName: file, fullPath, mtimeMs: stat.mtimeMs });
      }
    }
  }

  changedJsonFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const authJson = changedJsonFiles.find(file => file.fileName === 'auth.json');
  if (authJson) return authJson;
  if (changedJsonFiles.length > 0) return changedJsonFiles[0];

  const fallbackAuthPath = path.join(codexDir, 'auth.json');
  if (await pathExists(fallbackAuthPath)) {
    try {
      const fallbackAuthData = JSON.parse(await fs.readFile(fallbackAuthPath, 'utf8'));
      if (!looksLikeAuthFile(fallbackAuthData)) {
        return null;
      }
    } catch {
      return null;
    }
    return { fileName: 'auth.json', fullPath: fallbackAuthPath, mtimeMs: 0 };
  }

  return null;
}

/**
 * 切换账号时，将目标账号的 auth 文件复制到 Codex 的默认 auth 位置
 * Codex CLI 默认读取 ~/.codex/auth.json（无账号名后缀）
 */
async function switchAuthFile(authFilePath) {
  if (!authFilePath) return { ok: false, reason: 'auth_file_path 为空' };

  const src = expandPath(authFilePath);
  const defaultAuthDir = path.join(os.homedir(), '.codex');
  const dest = path.join(defaultAuthDir, 'auth.json');

  try {
    await fs.access(src);
    await fs.mkdir(defaultAuthDir, { recursive: true });
    await fs.copyFile(src, dest);

    // 同步更新 OpenClaw 的 auth-profiles.json
    const openclawResult = await syncOpenClawAuth(src);
    return { ok: true, dest, openclaw: openclawResult };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * 将账号的 OAuth token 同步到 OpenClaw 的 auth-profiles.json
 * 这样 OpenClaw 重启后就会用新账号
 */
async function syncOpenClawAuth(authFileSrc) {
  const openclawAuthPath = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');

  try {
    await fs.access(openclawAuthPath);
  } catch {
    return { ok: false, reason: 'openclaw auth-profiles.json 不存在' };
  }

  try {
    // 读取源 auth 文件
    const authData = JSON.parse(await fs.readFile(authFileSrc, 'utf8'));
    const accessToken = authData.tokens?.access_token;
    const refreshToken = authData.tokens?.refresh_token;
    if (!accessToken) return { ok: false, reason: 'no access_token in auth file' };

    // 从 JWT 解析 accountId 和过期时间
    const payload = decodeJwtPayload(accessToken);
    const accountId = payload?.['https://api.openai.com/auth']?.chatgpt_account_id ?? null;
    const expiresAt = payload?.exp ? payload.exp * 1000 : Date.now() + 864000000; // 默认 10 天

    // 读取 OpenClaw auth-profiles
    const profiles = JSON.parse(await fs.readFile(openclawAuthPath, 'utf8'));

    // 更新 openai-codex:default profile
    if (!profiles.profiles) profiles.profiles = {};
    profiles.profiles['openai-codex:default'] = {
      type: 'oauth',
      provider: 'openai-codex',
      access: accessToken,
      refresh: refreshToken || '',
      expires: expiresAt,
      accountId: accountId || '',
    };

    // 清除 cooldown 状态
    if (profiles.usageStats?.['openai-codex:default']) {
      delete profiles.usageStats['openai-codex:default'].cooldownUntil;
      delete profiles.usageStats['openai-codex:default'].lastFailureAt;
      profiles.usageStats['openai-codex:default'].errorCount = 0;
      profiles.usageStats['openai-codex:default'].failureCounts = {};
    }
    // 同样清除 openai:default 的 cooldown（因为它们共享限额）
    if (profiles.usageStats?.['openai:default']) {
      delete profiles.usageStats['openai:default'].cooldownUntil;
      delete profiles.usageStats['openai:default'].lastFailureAt;
      profiles.usageStats['openai:default'].errorCount = 0;
      profiles.usageStats['openai:default'].failureCounts = {};
    }

    // 写回文件
    await fs.writeFile(openclawAuthPath, JSON.stringify(profiles, null, 2));
    return { ok: true, email: payload?.['https://api.openai.com/profile']?.email };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ─────────────────────────────────────────────
// Token 自动刷新（使用 refresh_token 换取新 access_token）
// ─────────────────────────────────────────────

/**
 * 使用 refresh_token 向 OpenAI Auth0 端点换取新的 access_token
 * @param {string} authFilePath - auth 文件的完整路径
 * @returns {{ ok: boolean, reason?: string, newExpiresAt?: string }}
 */
async function refreshTokenForAuthFile(authFilePath) {
  const fullPath = expandPath(authFilePath);

  // 1. 读取现有 auth 文件
  let authData;
  try {
    authData = JSON.parse(await fs.readFile(fullPath, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `无法读取 auth 文件: ${err.message}` };
  }

  const refreshToken = authData.tokens?.refresh_token;
  if (!refreshToken) {
    return { ok: false, reason: '没有 refresh_token，需要手动重新登录' };
  }

  // 2. 从现有 access_token 中提取 client_id
  let clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'; // 默认 Codex CLI client_id
  const existingPayload = decodeJwtPayload(authData.tokens?.access_token);
  if (existingPayload?.client_id) {
    clientId = existingPayload.client_id;
  }

  // 3. 调用 OpenAI Auth0 token 端点
  try {
    const requestBody = JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });
    const resp = await requestJson('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
      body: requestBody,
      timeoutMs: 15000,
    });

    if (!resp.ok) {
      return { ok: false, reason: `Auth 端点返回 ${resp.status}: ${resp.text}` };
    }

    const data = resp.json;

    if (!data?.access_token) {
      return { ok: false, reason: '响应中没有 access_token' };
    }

    // 4. 更新 auth 文件
    authData.tokens.access_token = data.access_token;
    if (data.refresh_token) {
      authData.tokens.refresh_token = data.refresh_token;
    }
    if (data.id_token) {
      authData.tokens.id_token = data.id_token;
    }
    authData.last_refresh = new Date().toISOString();

    await fs.writeFile(fullPath, JSON.stringify(authData, null, 2));

    // 5. 解码新 token 获取过期时间
    const newPayload = decodeJwtPayload(data.access_token);
    const newExpiresAt = newPayload?.exp
      ? new Date(newPayload.exp * 1000).toISOString()
      : null;

    return { ok: true, newExpiresAt };
  } catch (err) {
    return { ok: false, reason: `网络请求失败: ${err.message}` };
  }
}

// ─────────────────────────────────────────────
// OpenClaw 进程管理
// ─────────────────────────────────────────────

const OPENCLAW_AUTH_PATH = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

/**
 * 读取 OpenClaw 网关配置（端口 + token），用于 API 调用
 */
async function getOpenClawGatewayConfig() {
  try {
    const data = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(data);
    return {
      port: cfg.gateway?.port || 18789,
      token: cfg.gateway?.auth?.token || '',
    };
  } catch {
    return { port: 18789, token: '' };
  }
}

/**
 * 尝试通过 OpenClaw Gateway API 触发 auth profile 重新加载
 * 如果 API 不可用，则回退到重启进程
 */
async function reloadOpenClaw() {
  const gw = await getOpenClawGatewayConfig();

  // 1. 先尝试 Gateway API（软重载，不中断正在运行的任务）
  try {
    const resp = await fetch(`http://127.0.0.1:${gw.port}/api/auth/reload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gw.token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      return { ok: true, method: 'gateway_api' };
    }
  } catch { /* Gateway 不可用或无此接口，继续回退 */ }

  // 2. 尝试 SIGHUP 信号（让 Gateway 热重载配置，不中断服务）
  try {
    const { stdout } = await execAsync("pgrep -f 'openclaw-gateway'");
    const pids = stdout.trim().split('\n').filter(Boolean);
    if (pids.length > 0) {
      for (const pid of pids) {
        await execAsync(`kill -HUP ${pid.trim()}`);
      }
      return { ok: true, method: 'sighup', pids };
    }
  } catch { /* pgrep 失败，继续回退 */ }

  // 3. 最终回退：重启 OpenClaw 进程
  return restartOpenClawProcess();
}

/**
 * 强制重启 OpenClaw 进程
 * 发送 SIGTERM 让它优雅退出，然后尝试重新启动
 */
async function restartOpenClawProcess() {
  try {
    // 查找 OpenClaw 主进程
    const { stdout } = await execAsync("pgrep -f 'openclaw-gateway' || pgrep -f 'openclaw.*main' || pgrep -f 'openclaw serve' || pgrep -f 'openclaw$'");
    const pids = stdout.trim().split('\n').filter(Boolean);

    if (pids.length === 0) {
      return { ok: false, reason: 'openclaw_not_running' };
    }

    // 发送 SIGTERM（优雅退出）
    for (const pid of pids) {
      try {
        await execAsync(`kill -TERM ${pid.trim()}`);
      } catch { /* 进程可能已退出 */ }
    }

    // 等待进程退出
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 尝试重启
    try {
      exec('nohup openclaw-gateway &>/dev/null &');
      return { ok: true, method: 'process_restart', pids };
    } catch {
      return { ok: true, method: 'process_killed', pids, note: 'OpenClaw 进程已终止，请手动重启' };
    }
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ─────────────────────────────────────────────
// auth-profiles.json 文件监控
// 检测 OpenClaw 是否覆写了 Pool Manager 的更改
// ─────────────────────────────────────────────

let expectedAccountId = null; // Pool Manager 期望的当前 accountId
let authFileWatcher = null;

/**
 * 设置期望的 accountId，用于监控
 */
function setExpectedAccountId(accountId) {
  expectedAccountId = accountId;
}

/**
 * 启动文件监控：检测 auth-profiles.json 被 OpenClaw 覆写
 */
async function startAuthFileWatcher() {
  if (authFileWatcher) return; // 已经在监控

  if (!await pathExists(OPENCLAW_AUTH_PATH)) {
    return;
  }

  try {
    authFileWatcher = fsSync.watch(OPENCLAW_AUTH_PATH, { persistent: false }, async (eventType) => {
      if (eventType !== 'change' || !expectedAccountId) return;

      // 防抖：等 500ms 后再检查（文件可能被多次写入）
      setTimeout(async () => {
        try {
          const data = await fs.readFile(OPENCLAW_AUTH_PATH, 'utf8');
          const profiles = JSON.parse(data);
          const currentToken = profiles.profiles?.['openai-codex:default']?.access;
          if (!currentToken) return;

          const payload = decodeJwtPayload(currentToken);
          const fileAccountId = payload?.['https://api.openai.com/auth']?.chatgpt_account_id;

          if (fileAccountId && fileAccountId !== expectedAccountId) {
            console.warn(`[文件监控] auth-profiles.json 被覆写！期望=${expectedAccountId}，实际=${fileAccountId}，正在修复...`);
            await createLog({
              level: 'warn',
              message: `[文件监控] OpenClaw 覆写了 auth-profiles.json (${fileAccountId})，正在恢复`,
            });

            // 重新获取当前活跃账号并覆写回来
            const [activeRows] = await pool.query("SELECT * FROM accounts WHERE is_current = TRUE LIMIT 1");
            if (activeRows.length) {
              const authFilePath = expandPath(activeRows[0].auth_file_path);
              await syncOpenClawAuth(authFilePath);
              // 再次重载 OpenClaw
              await reloadOpenClaw();
            }
          }
        } catch { /* 文件解析失败，忽略 */ }
      }, 500);
    });
    console.log('[文件监控] 已启动 auth-profiles.json 监控');
  } catch (err) {
    console.warn('[文件监控] 无法监控 auth-profiles.json:', err.message);
  }
}

async function createLog({ accountId = null, level = 'info', message }) {
  await pool.execute(
    'INSERT INTO logs (id, account_id, level, message, created_at) VALUES (?, ?, ?, ?, NOW())',
    [crypto.randomUUID(), accountId, level, message],
  );
}

// ─────────────────────────────────────────────
// 轮换策略
// ─────────────────────────────────────────────

/**
 * 根据配置的策略选择下一个账号
 * @param {Array} allAccounts - 所有可用账号
 * @param {string} currentId - 当前活跃账号 ID
 * @param {string} strategy - 轮换策略
 * @returns {object|null} 下一个账号
 */
function pickNextAccount(allAccounts, currentId, strategy = 'round_robin') {
  const candidates = allAccounts.filter(a => a.id !== currentId && a.status !== 'error');
  if (candidates.length === 0) return null;

  switch (strategy) {
    case 'least_used': {
      // 按 tokens_used_percent 升序，取最低的
      candidates.sort((a, b) => a.tokens_used_percent - b.tokens_used_percent);
      return candidates[0];
    }
    case 'random': {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    case 'priority_based': {
      // team > plus > free，同类型按 tokens_used_percent 升序
      const typeOrder = { team: 0, plus: 1, free: 2 };
      candidates.sort((a, b) => {
        const typeDiff = (typeOrder[a.auth_type] ?? 9) - (typeOrder[b.auth_type] ?? 9);
        return typeDiff !== 0 ? typeDiff : a.tokens_used_percent - b.tokens_used_percent;
      });
      return candidates[0];
    }
    case 'round_robin':
    default: {
      const idx = allAccounts.findIndex(a => a.id === currentId);
      // 从当前位置往后找到第一个可用的
      for (let i = 1; i <= allAccounts.length; i++) {
        const next = allAccounts[(idx + i) % allAccounts.length];
        if (next.id !== currentId && next.status !== 'error') return next;
      }
      return candidates[0];
    }
  }
}

/**
 * 执行账号切换的通用逻辑（更新数据库 + 切换 auth 文件 + 重载 OpenClaw）
 */
async function performAccountSwitch(nextAccount, reason) {
  if (isApiAccount(nextAccount)) {
    await activateCodexApiProvider(nextAccount);
  } else {
    await restoreCodexOAuthProvider();
    await switchAuthFile(nextAccount.auth_file_path);
  }
  await pool.execute("UPDATE accounts SET is_current = FALSE, status = CASE WHEN status = 'active' THEN 'idle' ELSE status END, updated_at = NOW()");
  await pool.execute("UPDATE accounts SET is_current = TRUE, status = 'active', updated_at = NOW() WHERE id = ?", [nextAccount.id]);
  await createLog({ accountId: nextAccount.id, message: reason });

  if (isApiAccount(nextAccount)) {
    await createLog({ accountId: nextAccount.id, message: `[API] 已切换默认中转站至 ${nextAccount.account_id}` });
    return;
  }

  // 从 auth 文件中获取 accountId 用于文件监控
  try {
    const authFilePath = expandPath(nextAccount.auth_file_path);
    const authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
    const payload = decodeJwtPayload(authData.tokens?.access_token);
    const accId = payload?.['https://api.openai.com/auth']?.chatgpt_account_id;
    if (accId) setExpectedAccountId(accId);
  } catch { /* 忽略 */ }

  // 重载 OpenClaw，确保它使用新 token
  const reloadResult = await reloadOpenClaw();
  if (reloadResult.ok) {
    await createLog({ accountId: nextAccount.id, message: `[OpenClaw] 已重载 (${reloadResult.method})` });
  } else {
    await createLog({ accountId: nextAccount.id, level: 'warn', message: `[OpenClaw] 重载失败: ${reloadResult.reason}` });
  }
}

// ─────────────────────────────────────────────
// Codex 用量检测（共用核心逻辑）
// ─────────────────────────────────────────────

/**
 * 调 wham/usage 接口获取用量，完全不消耗 Codex token。
 * 始终返回对象: { ok, error?, status?, primary_used?, secondary_used?, plan_type?, primary?, secondary? }
 */
async function fetchUsageForAccount(account) {
  if (isApiAccount(account)) {
    return fetchUsageForApiAccount(account);
  }

  const authFilePath = expandPath(account.auth_file_path);
  try {
    await fs.access(authFilePath);
  } catch {
    return { ok: false, error: 'auth_file_not_found' };
  }

  let authData;
  try {
    authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
  } catch {
    return { ok: false, error: 'invalid_auth_file' };
  }

  const accessToken = authData.tokens?.access_token;
  if (!accessToken) return { ok: false, error: 'no_access_token' };

  try {
    const resp = await requestJson('https://chatgpt.com/backend-api/wham/usage', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeoutMs: 15000,
    });

    if (resp.status === 401) return { ok: false, error: 'token_invalid', status: 401 };
    if (!resp.ok) return { ok: false, error: `http_${resp.status}`, status: resp.status };

    const data = resp.json;
    const rl = data.rate_limit;
    if (!rl) return { ok: false, error: 'no_rate_limit_data' };

    const pw = rl.primary_window;
    const sw = rl.secondary_window;

    const primary = pw ? {
      used_percent: pw.used_percent ?? 0,
      window_minutes: Math.round((pw.limit_window_seconds ?? 18000) / 60),
      resets_at: pw.reset_at ? new Date(pw.reset_at * 1000).toISOString() : null,
    } : null;

    const secondary = sw ? {
      used_percent: sw.used_percent ?? 0,
      window_minutes: Math.round((sw.limit_window_seconds ?? 604800) / 60),
      resets_at: sw.reset_at ? new Date(sw.reset_at * 1000).toISOString() : null,
    } : null;

    if (rl.limit_reached) {
      return {
        ok: false, error: 'rate_limited', status: 429,
        primary_used: pw?.used_percent ?? 0,
        secondary_used: sw?.used_percent ?? 0,
        plan_type: data.plan_type ?? null,
        primary, secondary,
      };
    }

    return {
      ok: true,
      primary_used: pw?.used_percent ?? 0,
      secondary_used: sw?.used_percent ?? 0,
      plan_type: data.plan_type ?? null,
      primary, secondary,
    };
  } catch (err) {
    const errorName = err?.name || 'Error';
    const causeCode = err?.cause?.code || '';
    const causeMessage = err?.cause?.message || '';
    const lowerMessage = String(err?.message || '').toLowerCase();
    const lowerCause = String(causeMessage).toLowerCase();

    if (errorName === 'TimeoutError' || lowerMessage.includes('timeout')) {
      return { ok: false, error: '连接 chatgpt.com 超时，请检查网络或代理设置' };
    }

    if (causeCode === 'ENOTFOUND' || lowerCause.includes('getaddrinfo')) {
      return { ok: false, error: '无法解析 chatgpt.com，请检查 DNS 或代理设置' };
    }

    if (causeCode === 'ECONNREFUSED') {
      return { ok: false, error: '连接被拒绝，请检查网络或代理设置' };
    }

    if (causeCode === 'ECONNRESET') {
      return { ok: false, error: '连接被重置，请检查网络或代理设置' };
    }

    return {
      ok: false,
      error: `请求 chatgpt.com 失败: ${causeCode || causeMessage || err.message || 'unknown error'}`,
    };
  }
}

async function fetchUsageForApiAccount(account) {
  const baseUrl = normalizeApiBaseUrl(account.api_base_url);
  const apiKey = String(account.api_key || '').trim();

  if (!baseUrl) return { ok: false, error: 'api_base_url_missing' };
  if (!apiKey) return { ok: false, error: 'api_key_missing' };

  try {
    const resp = await requestJson(buildRelayUrl(baseUrl, 'models'), {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      timeoutMs: 15000,
    });

    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, error: 'token_invalid', status: resp.status };
    }
    if (!resp.ok) {
      return { ok: false, error: `http_${resp.status}`, status: resp.status };
    }

    const models = Array.isArray(resp.json?.data) ? resp.json.data : [];
    const modelAvailable = account.api_model
      ? models.some(model => model?.id === account.api_model)
      : true;

    if (account.api_model && !modelAvailable) {
      return {
        ok: false,
        error: 'api_model_not_found',
        status: 404,
        provider: 'api',
        model_count: models.length,
      };
    }

    return {
      ok: true,
      plan_type: 'api',
      primary: null,
      secondary: null,
      provider: 'api',
      model_available: modelAvailable,
      model_count: models.length,
    };
  } catch (error) {
    const message = String(error?.message || 'unknown error');
    if (message.toLowerCase().includes('timeout')) {
      return { ok: false, error: '连接中转站超时，请检查代理或中转站地址' };
    }
    return { ok: false, error: `请求中转站失败: ${message}` };
  }
}

/**
 * check-usage / refresh-codex-usage 的共用处理逻辑
 * 返回最终 JSON 响应体
 */
async function handleUsageCheck(id) {
  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  if (!rows.length) return { _status: 404, message: '账号不存在' };

  const account = rows[0];
  const usage = await fetchUsageForAccount(account);

  if (usage.error === 'rate_limited') {
    await pool.execute("UPDATE accounts SET status = 'rate_limited', updated_at = NOW() WHERE id = ?", [id]);
    await createLog({ accountId: id, level: 'warn', message: `Codex 已限额 (5h=${usage.primary_used ?? '?'}% 周=${usage.secondary_used ?? '?'}%)` });
    return {
      ok: false, rate_limited: true, status: 429,
      primary: usage.primary ?? null,
      secondary: usage.secondary ?? null,
      fetched_at: new Date().toISOString(),
    };
  }

  if (usage.error === 'token_invalid') {
    await pool.execute("UPDATE accounts SET status = 'error', updated_at = NOW() WHERE id = ?", [id]);
    await createLog({ accountId: id, level: 'error', message: 'Token 已失效 (401)' });
    return { ok: false, status: 401, error: 'token_invalid' };
  }

  if (!usage.ok) {
    await createLog({ accountId: id, level: 'error', message: `检测失败: ${usage.error}` });
    return { ok: false, error: usage.error };
  }

  if (usage.provider === 'api') {
    if (account.status === 'error' || account.status === 'rate_limited') {
      await pool.execute("UPDATE accounts SET status = 'idle', updated_at = NOW() WHERE id = ?", [id]);
    }
    await createLog({ accountId: id, message: `[API] 中转站连通正常${account.api_model ? ` (${account.api_model})` : ''}` });
    return {
      ok: true,
      status: 200,
      plan_type: account.auth_type,
      primary: null,
      secondary: null,
      fetched_at: new Date().toISOString(),
      provider: 'api',
      model_available: usage.model_available ?? true,
      model_count: usage.model_count ?? 0,
    };
  }

  // 成功：更新状态 + 同步 plan_type + 返回用量
  const planType = usage.plan_type;
  const validTypes = ['team', 'plus', 'free'];
  if (planType && validTypes.includes(planType) && account.auth_type !== planType) {
    await pool.execute('UPDATE accounts SET auth_type = ?, updated_at = NOW() WHERE id = ?', [planType, id]);
  } else if (account.status === 'error' || account.status === 'rate_limited') {
    await pool.execute("UPDATE accounts SET status = 'idle', updated_at = NOW() WHERE id = ?", [id]);
  }
  await createLog({ accountId: id, message: `Codex 可用 (5h=${usage.primary_used}% 周=${usage.secondary_used}%)` });
  return {
    ok: true, status: 200,
    primary: usage.primary,
    secondary: usage.secondary,
    plan_type: usage.plan_type,
    fetched_at: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// Express 应用
// ─────────────────────────────────────────────

const app = express();

app.use(cors({ origin: config.frontendOrigin }));
app.use(express.json());

function mapAccount(row) {
  return {
    ...row,
    is_current: Boolean(row.is_current),
    success_rate: Number(row.success_rate),
    uptime_percent: Number(row.uptime_percent),
    provider_mode: row.provider_mode || 'oauth',
    api_base_url: row.api_base_url || '',
    api_model: row.api_model || '',
    api_cli_config: row.api_cli_config || '',
  };
}

function mapTask(row) {
  return {
    ...row,
    assigned_account_name: row.assigned_account_name || undefined,
  };
}

// ─── Health ───

app.get('/api/health', asyncHandler(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

app.get('/api/codex/current-auth', asyncHandler(async (_req, res) => {
  const matrixState = await readCodexMatrixState();
  if (matrixState?.mode === 'api') {
    return res.json({
      found: true,
      provider_mode: 'api',
      path: CODEX_CONFIG_PATH,
      email: matrixState.email || null,
      account_id: matrixState.account_id || null,
      plan_type: null,
      token_expires_at: null,
      api_base_url: matrixState.api_base_url || null,
      api_model: matrixState.api_model || null,
      api_cli_config: matrixState.api_cli_config || null,
    });
  }

  const authPath = CODEX_AUTH_PATH;

  try {
    await fs.access(authPath);
  } catch {
    return res.json({ found: false, error: 'auth_file_not_found', path: authPath });
  }

  let authData;
  try {
    authData = JSON.parse(await fs.readFile(authPath, 'utf8'));
  } catch {
    return res.json({ found: false, error: 'invalid_auth_file', path: authPath });
  }

  if (authData?.OPENAI_API_KEY && !authData?.tokens?.access_token) {
    return res.json({
      found: true,
      provider_mode: 'api',
      path: authPath,
      email: null,
      account_id: 'OPENAI_API_KEY',
      plan_type: null,
      token_expires_at: null,
      api_base_url: null,
      api_model: null,
      api_cli_config: null,
    });
  }

  const identity = getAuthIdentity(authData);
  const authClaims = identity.payload?.['https://api.openai.com/auth'] || {};

  res.json({
    found: true,
    provider_mode: 'oauth',
    path: authPath,
    email: identity.email || null,
    account_id: identity.accountId || null,
    plan_type: authClaims.chatgpt_plan_type || null,
    token_expires_at: identity.payload?.exp ? new Date(identity.payload.exp * 1000).toISOString() : null,
  });
}));

app.get('/api/codex/managed-status', asyncHandler(async (_req, res) => {
  const [currentRows] = await pool.query("SELECT * FROM accounts WHERE is_current = TRUE LIMIT 1");
  const currentAccount = currentRows[0] ? mapAccount(currentRows[0]) : null;
  const matrixState = await readCodexMatrixState();
  const configText = await readCodexConfigText();
  const detected = detectCodexManagedProvider(configText);

  res.json({
    ok: true,
    current_account_id: currentAccount?.account_id || null,
    current_provider_mode: currentAccount?.provider_mode || null,
    cli_managed: detected.managed,
    cli_provider: detected.provider,
    cli_model: detected.model,
    matrix_state_mode: matrixState?.mode || null,
    matrix_state_account_id: matrixState?.account_id || null,
    expected_account_id: isApiAccount(currentAccount) ? currentAccount.account_id : null,
    config_path: CODEX_CONFIG_PATH,
  });
}));

// ─── Accounts ───

app.get('/api/accounts', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM accounts ORDER BY is_current DESC, account_id ASC');
  res.json(rows.map(mapAccount));
}));

// 扫描目录，自动发现 auth 文件
app.get('/api/accounts/scan-dir', asyncHandler(async (req, res) => {
  const dir = req.query.dir ? expandPath(req.query.dir) : PROJECT_ACCOUNTS_DIR;
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return res.json({ files: [], error: `目录不存在或无权限: ${dir}` });
  }

  const jsonFiles = entries.filter(f => f.endsWith('.json'));

  // 获取已存在的账号信息，用邮箱+路径双重判断重复
  const [existingRows] = await pool.query('SELECT auth_file_path, email FROM accounts');
  const existingPaths = new Set(existingRows.map(r => r.auth_file_path));
  const existingEmails = new Set(existingRows.map(r => (r.email || '').toLowerCase()).filter(Boolean));

  const results = [];
  for (const file of jsonFiles) {
    const fullPath = path.join(dir, file);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const parsed = JSON.parse(content);

      // Try to derive a stable identity from the auth payload.
      const identity = getAuthIdentity(parsed);
      const email = identity.email;

      // 调 wham/usage 获取真实 plan_type（不消耗 token）
      let auth_type = 'plus';
      const accessToken = identity.accessToken;
      if (accessToken) {
        try {
          const whamResp = await requestJson('https://chatgpt.com/backend-api/wham/usage', {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
            timeoutMs: 8000,
          });
          if (whamResp.ok) {
            const whamData = whamResp.json;
            const pt = whamData.plan_type || '';
            auth_type = pt.includes('team') ? 'team' : pt.includes('free') ? 'free' : 'plus';
          }
        } catch { /* 网络失败就用默认值 */ }
      }

      const suggestedName = buildAuthStorageFileName(parsed, file).fileName.replace(/\.json$/, '');
      results.push({
        file,
        full_path: fullPath,
        til_path: fullPath,
        email,
        auth_type,
        suggested_name: suggestedName,
        already_added: existingPaths.has(fullPath) || (!!email && existingEmails.has(email.toLowerCase())),
        duplicate_reason: existingPaths.has(fullPath) ? '已添加' : (email && existingEmails.has(email.toLowerCase())) ? '邮箱重复' : null,
      });
    } catch {
      results.push({ file, full_path: fullPath, error: '无法读取或解析' });
    }
  }

  res.json({ files: results, dir });
}));

app.post('/api/accounts', asyncHandler(async (req, res) => {
  const body = req.body;
  const id = crypto.randomUUID();
  const platform = body.platform || 'gpt';
  const providerMode = body.provider_mode === 'api' ? 'api' : 'oauth';
  await pool.execute(
    `INSERT INTO accounts (
      id, account_id, email, auth_type, auth_file_path, provider_mode, api_base_url, api_key, api_model, api_cli_config, platform, status, is_current,
      last_login_at, total_tasks_completed, success_rate, session_start_at,
      total_session_seconds, requests_this_minute, tokens_used_percent,
      last_request_at, uptime_percent, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', FALSE, NOW(), 0, 100, NOW(), 0, 0, 0, NOW(), 100, NOW(), NOW())`,
    [
      id,
      body.account_id,
      body.email || '',
      body.auth_type,
      body.auth_file_path || '',
      providerMode,
      body.api_base_url || '',
      body.api_key || '',
      body.api_model || '',
      body.api_cli_config || '',
      platform,
    ],
  );
  await createLog({ accountId: id, message: `Account ${body.account_id} added` });
  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  res.status(201).json(mapAccount(rows[0]));
}));

app.patch('/api/accounts/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;

  if (action === 'setActive') {
    const [targetRows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
    if (targetRows.length === 0) {
      return res.status(404).json({ message: '账号不存在' });
    }
    const targetAccount = targetRows[0];

    // 复用 performAccountSwitch()，避免逻辑重复
    await performAccountSwitch(targetAccount, `手动切换至 ${targetAccount.account_id}`);
  } else if (action === 'pause') {
    await pool.execute("UPDATE accounts SET status = 'idle', is_current = FALSE, updated_at = NOW() WHERE id = ?", [id]);
    await createLog({ accountId: id, level: 'warn', message: 'Account paused' });
  } else if (action === 'reset') {
    await pool.execute(
      'UPDATE accounts SET status = ?, requests_this_minute = 0, tokens_used_percent = 0, updated_at = NOW() WHERE id = ?',
      ['idle', id],
    );
    await createLog({ accountId: id, message: 'Account reset' });
  } else {
    return res.status(400).json({ message: 'Unsupported action' });
  }

  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  res.json(mapAccount(rows[0]));
}));

app.put('/api/accounts/:id/api-cli-config', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [targetRows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  if (!targetRows.length) {
    return res.status(404).json({ message: '账号不存在' });
  }

  const account = targetRows[0];
  if (!isApiAccount(account)) {
    return res.status(400).json({ message: '仅 API 账号支持编辑 CLI 配置' });
  }

  const nextSnippet = sanitizeApiCliConfigSnippet(req.body?.api_cli_config || '');
  await pool.execute('UPDATE accounts SET api_cli_config = ?, updated_at = NOW() WHERE id = ?', [nextSnippet, id]);

  if (account.is_current) {
    await activateCodexApiProvider({ ...account, api_cli_config: nextSnippet });
    await createLog({ accountId: id, message: `[API] 已同步更新 CLI 配置片段` });
  } else {
    await createLog({ accountId: id, message: `[API] 已更新 CLI 配置片段` });
  }

  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  res.json(mapAccount(rows[0]));
}));

app.post('/api/accounts/:id/api-cli-config/preview', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [targetRows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  if (!targetRows.length) {
    return res.status(404).json({ message: '账号不存在' });
  }

  const account = targetRows[0];
  if (!isApiAccount(account)) {
    return res.status(400).json({ message: '仅 API 账号支持预览 CLI 配置' });
  }

  const sanitized = sanitizeApiCliConfigSnippet(req.body?.api_cli_config || '');
  const block = buildManagedCodexProviderBlock({ ...account, api_cli_config: sanitized });

  res.json({
    ok: true,
    sanitized,
    preview: block,
  });
}));

app.delete('/api/accounts/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  await pool.execute('DELETE FROM accounts WHERE id = ?', [id]);
  await createLog({ level: 'warn', message: `Account ${id} removed` });
  res.status(204).end();
}));

// 清空所有账号（用于清除假数据）
app.delete('/api/accounts', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM accounts');
  const count = rows[0].count;
  await pool.query('DELETE FROM accounts');
  await createLog({ level: 'warn', message: `已清空全部 ${count} 个账号` });
  res.status(204).end();
}));

// 读取账号 auth 文件，解析邮箱 / 套餐 / token 有效期 / OpenAI 用量
app.get('/api/accounts/:id/auth-info', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ message: '账号不存在' });

  const account = rows[0];
  if (isApiAccount(account)) {
    return res.json({
      email: account.email || null,
      plan_type: account.auth_type,
      token_expires_at: null,
      subscription_started_at: null,
      subscription_expires_at: null,
      subscription_last_checked_at: null,
      last_refresh: null,
      usage: null,
      provider_mode: 'api',
      api_base_url: account.api_base_url || null,
      api_model: account.api_model || null,
      api_cli_config: account.api_cli_config || null,
    });
  }
  const authFilePath = expandPath(account.auth_file_path);

  try {
    await fs.access(authFilePath);
  } catch {
    return res.json({ error: 'auth_file_not_found', path: account.auth_file_path });
  }

  let authData;
  try {
    authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
  } catch {
    return res.json({ error: 'invalid_auth_file' });
  }

  const idToken = authData.tokens?.id_token;
  const accessToken = authData.tokens?.access_token;

  // 从 JWT 解析基本信息
  let email = null, plan_type = null, token_expires_at = null;
  let subscription_started_at = null, subscription_expires_at = null, subscription_last_checked_at = null;
  if (idToken) {
    const decoded = decodeJwtPayload(idToken);
    if (decoded) {
      email = decoded.email;
      const authClaims = decoded['https://api.openai.com/auth'] || {};
      plan_type = authClaims.chatgpt_plan_type ?? null;
      subscription_started_at = authClaims.chatgpt_subscription_active_start ?? null;
      subscription_expires_at = authClaims.chatgpt_subscription_active_until ?? null;
      subscription_last_checked_at = authClaims.chatgpt_subscription_last_checked ?? null;
    }
  }

  if (accessToken) {
    const decoded = decodeJwtPayload(accessToken);
    if (decoded?.exp) {
      token_expires_at = new Date(decoded.exp * 1000).toISOString();
      if (!email && decoded['https://api.openai.com/profile']?.email) {
        email = decoded['https://api.openai.com/profile'].email;
      }
      if (!plan_type && decoded['https://api.openai.com/auth']?.chatgpt_plan_type) {
        plan_type = decoded['https://api.openai.com/auth'].chatgpt_plan_type;
      }
    }
  }

  // 尝试调用 OpenAI API 获取账号用量（5小时 / 周限制）
  let usage = null;
  if (accessToken) {
    try {
      const resp = await requestJson('https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        timeoutMs: 6000,
      });
      if (resp.ok) {
        const data = resp.json;
        const limits = data?.account_plan?.is_paid_subscription_active !== undefined ? data : null;
        if (limits) {
          usage = {
            plan: limits.account_plan?.plan_type,
            is_paid: limits.account_plan?.is_paid_subscription_active,
            message_cap: limits.message_cap ?? null,
            message_cap_rollover: limits.message_cap_rollover ?? null,
          };
        }
      }
    } catch { /* 网络超时或接口不可用，忽略 */ }
  }

  res.json({
    email,
    plan_type,
    token_expires_at,
    subscription_started_at,
    subscription_expires_at,
    subscription_last_checked_at,
    last_refresh: authData.last_refresh ?? null,
    usage,
    provider_mode: 'oauth',
  });
}));

// 检测账号可用性 + 获取实时用量（共用 handleUsageCheck）
app.post('/api/accounts/:id/check-usage', asyncHandler(async (req, res) => {
  const result = await handleUsageCheck(req.params.id);
  const httpStatus = result._status || 200;
  delete result._status;
  res.status(httpStatus).json(result);
}));

// 刷新用量（转发到共用逻辑）
app.post('/api/accounts/:id/refresh-codex-usage', asyncHandler(async (req, res) => {
  const result = await handleUsageCheck(req.params.id);
  const httpStatus = result._status || 200;
  delete result._status;
  res.status(httpStatus).json(result);
}));

// ─── Platforms ───

const PLATFORMS_FILE = path.join(__dirname, 'platforms.json');
const DEFAULT_PLATFORMS = ['gpt', 'gemini', 'claude'];

async function readPlatforms() {
  try {
    const data = await fs.readFile(PLATFORMS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [...DEFAULT_PLATFORMS];
  }
}

async function writePlatforms(platforms) {
  await fs.writeFile(PLATFORMS_FILE, JSON.stringify(platforms), 'utf8');
}

app.get('/api/platforms', asyncHandler(async (_req, res) => {
  const platforms = await readPlatforms();
  res.json(platforms);
}));

app.post('/api/platforms', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: '平台名称不能为空' });
  }
  const clean = name.trim().toLowerCase();
  const platforms = await readPlatforms();
  if (platforms.includes(clean)) {
    return res.status(409).json({ message: '平台已存在' });
  }
  platforms.push(clean);
  await writePlatforms(platforms);
  res.status(201).json(platforms);
}));

app.delete('/api/platforms/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;
  const platforms = await readPlatforms();
  const index = platforms.indexOf(name);
  if (index === -1) {
    return res.status(404).json({ message: '平台不存在' });
  }
  platforms.splice(index, 1);
  await writePlatforms(platforms);
  res.json(platforms);
}));

// ─── Codex Login ───

// In-memory login session state (one at a time)
let loginSession = {
  status: 'idle',   // 'idle' | 'running' | 'success' | 'error'
  message: '',
  output: '',
  newFile: null,    // filename that was copied to accounts/
  error: null,
};
let loginProc = null;

/**
 * Find the codex binary:
 * 1. Use settings path if set and the file actually exists
 * 2. Try `which codex` via shell
 * 3. Fall back to bare "codex" (let the shell resolve it)
 */
async function resolveCodexBin() {
  const [settingsRows] = await pool.query('SELECT codex_path FROM settings WHERE id = 1');
  const fromSettings = (settingsRows[0]?.codex_path || '').trim();

  if (fromSettings) {
    try { await fs.access(fromSettings); return fromSettings; } catch { /* path invalid, fall through */ }
  }

  // Try to locate via shell `which`
  try {
    const { stdout } = await execAsync('which codex || command -v codex');
    const found = stdout.trim();
    if (found) return found;
  } catch { /* not in PATH */ }

  return 'codex'; // last resort — shell: true below will try PATH again
}

async function resolveCodexCommand() {
  const [settingsRows] = await pool.query('SELECT codex_path FROM settings WHERE id = 1');
  const fromSettings = (settingsRows[0]?.codex_path || '').trim();
  const candidates = [];
  const seen = new Set();

  const pushCandidate = (command) => {
    const normalized = String(command || '').trim();
    if (!normalized) return;

    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return;

    seen.add(key);
    candidates.push(normalized);
  };

  pushCandidate(fromSettings);

  if (process.platform === 'win32') {
    for (const lookupCommand of ['where.exe codex.cmd', 'where.exe codex.bat', 'where.exe codex.exe', 'where.exe codex']) {
      try {
        const { stdout } = await execAsync(lookupCommand);
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .forEach(pushCandidate);
      } catch { /* ignore missing command */ }
    }
  } else {
    try {
      const { stdout } = await execAsync('which codex || command -v codex');
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach(pushCandidate);
    } catch { /* ignore missing command */ }
  }

  pushCandidate('codex');

  const failures = [];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      try {
        await fs.access(candidate);
      } catch (error) {
        failures.push({ command: candidate, reason: `路径不可访问: ${error.message}` });
        continue;
      }
    }

    const probe = await probeCodexCandidate(candidate);
    if (probe.ok) {
      return { ok: true, command: candidate };
    }

    failures.push({ command: candidate, reason: probe.reason || '无法执行' });
  }

  return {
    ok: false,
    message: getCodexUnavailableMessage(failures),
    details: formatCodexProbeSummary(failures),
  };
}

app.post('/api/auth/codex-login', asyncHandler(async (_req, res) => {
  if (loginProc) {
    return res.status(409).json({ message: '已有登录进程正在运行，请等待或取消' });
  }

  const resolvedCodex = await resolveCodexCommand();
  if (!resolvedCodex.ok) {
    loginSession = {
      status: 'error',
      message: resolvedCodex.message,
      output: resolvedCodex.details,
      newFile: null,
      error: resolvedCodex.message,
    };
    return res.status(400).json({ message: resolvedCodex.message });
  }

  const codexBin = resolvedCodex.command;

  // Snapshot existing files in ~/.codex/ before login
  const codexDir = path.join(os.homedir(), '.codex');
  let beforeFiles = new Set();
  try {
    const files = await fs.readdir(codexDir);
    for (const f of files) {
      const stat = await fs.stat(path.join(codexDir, f));
      beforeFiles.add(`${f}::${stat.mtimeMs}`);
    }
  } catch { /* dir may not exist yet */ }

  loginSession = { status: 'running', message: '正在启动 codex login…', output: '', newFile: null, error: null };

  // shell: true → lets the OS shell search PATH, handles aliases & env properly
  try {
    loginProc = spawn(codexBin, ['login'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: shouldUseShellForBinary(codexBin),
      windowsHide: true,
      env: getCodexCommandEnv(),
    });
  } catch (error) {
    loginSession = {
      status: 'error',
      message: `无法启动 codex: ${error.message}`,
      output: loginSession.output,
      newFile: null,
      error: error.message,
    };
    return res.status(400).json({ message: loginSession.message });
  }

  const appendOutput = (chunk) => {
    const text = stripAnsi(chunk.toString());
    loginSession.output += text;
    // Use last non-empty line as the status message
    const lines = loginSession.output.trim().split('\n').filter(Boolean);
    loginSession.message = lines[lines.length - 1] || '…';
  };

  loginProc.stdout.on('data', appendOutput);
  loginProc.stderr.on('data', appendOutput);

  loginProc.on('error', (err) => {
    loginProc = null;
    loginSession = { status: 'error', message: `无法启动 codex: ${err.message}`, output: loginSession.output, newFile: null, error: err.message };
  });

  loginProc.on('exit', async (code) => {
    loginProc = null;
    if (code !== 0) {
      loginSession = { status: 'error', message: `登录失败 (exit ${code})`, output: loginSession.output, newFile: null, error: `exit ${code}` };
      return;
    }

    // Find newly added or updated auth files in ~/.codex/
    try {
      await fs.mkdir(codexDir, { recursive: true });
      const latestAuthFile = await findLatestChangedAuthFile(codexDir, beforeFiles);

      if (latestAuthFile) {
        const saved = await saveAuthFileToAccounts(latestAuthFile.fullPath, latestAuthFile.fileName);
        loginSession = { status: 'success', message: `登录成功！已保存 ${saved.fileName}`, output: loginSession.output, newFile: saved.fileName, error: null };
      } else {
        loginSession = { status: 'success', message: '登录成功，但未找到可保存的 auth 文件', output: loginSession.output, newFile: null, error: 'auth_file_not_found' };
      }
    } catch (e) {
      loginSession = { status: 'success', message: '登录成功，但保存 auth 文件失败', output: loginSession.output, newFile: null, error: e.message };
    }
  });

  res.json({ ok: true });
}));

app.get('/api/auth/codex-login/status', asyncHandler(async (_req, res) => {
  res.json(loginSession);
}));

app.delete('/api/auth/codex-login', asyncHandler(async (_req, res) => {
  if (loginProc) {
    loginProc.kill('SIGTERM');
    loginProc = null;
  }
  loginSession = { status: 'idle', message: '', output: '', newFile: null, error: null };
  res.json({ ok: true });
}));

// ─── Tasks ───

app.get('/api/tasks', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(`
    SELECT tasks.*, accounts.account_id AS assigned_account_name
    FROM tasks
    LEFT JOIN accounts ON accounts.id = tasks.assigned_account_id
    ORDER BY tasks.created_at DESC
  `);
  res.json(rows.map(mapTask));
}));

app.post('/api/tasks', asyncHandler(async (req, res) => {
  const { description, priority, account } = req.body;
  let assignedAccountId = null;

  if (account && account !== 'auto') {
    assignedAccountId = account;
  } else {
    const [accounts] = await pool.query("SELECT id FROM accounts WHERE status IN ('active', 'idle') ORDER BY is_current DESC, updated_at ASC LIMIT 1");
    assignedAccountId = accounts[0]?.id || null;
  }

  const id = crypto.randomUUID();
  await pool.execute(
    `INSERT INTO tasks (
      id, description, assigned_account_id, status, priority, result,
      error_message, retry_count, created_at, started_at, completed_at
    ) VALUES (?, ?, ?, 'queued', ?, NULL, NULL, 0, NOW(), NULL, NULL)`,
    [id, description, assignedAccountId, priority],
  );
  await createLog({ accountId: assignedAccountId, message: `Task created: ${description}` });

  const [rows] = await pool.query(`
    SELECT tasks.*, accounts.account_id AS assigned_account_name
    FROM tasks
    LEFT JOIN accounts ON accounts.id = tasks.assigned_account_id
    WHERE tasks.id = ?
  `, [id]);
  res.status(201).json(mapTask(rows[0]));
}));

app.post('/api/tasks/batch-retry', asyncHandler(async (req, res) => {
  const ids = req.body.ids || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.json({ updated: 0 });
  }

  await pool.query(`UPDATE tasks SET status = 'queued', retry_count = retry_count + 1, error_message = NULL, result = NULL WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await createLog({ level: 'info', message: `${ids.length} tasks queued for retry` });
  res.json({ updated: ids.length });
}));

app.post('/api/tasks/batch-cancel', asyncHandler(async (req, res) => {
  const ids = req.body.ids || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.json({ deleted: 0 });
  }

  await pool.query(`DELETE FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await createLog({ level: 'warn', message: `${ids.length} tasks cancelled` });
  res.json({ deleted: ids.length });
}));

// ─── Logs（支持 limit 参数） ───

app.get('/api/logs', asyncHandler(async (req, res) => {
  const { level = 'all', account = 'all', limit } = req.query;
  let sql = `
    SELECT logs.*, accounts.account_id AS account_name
    FROM logs
    LEFT JOIN accounts ON accounts.id = logs.account_id
    WHERE 1 = 1
  `;
  const params = [];

  if (level !== 'all') {
    sql += ' AND logs.level = ?';
    params.push(level);
  }
  if (account !== 'all') {
    sql += ' AND accounts.account_id = ?';
    params.push(account);
  }

  sql += ' ORDER BY logs.created_at ASC';

  // 支持 limit 参数（用于 Dashboard 只拉最近 N 条）
  if (limit && Number(limit) > 0) {
    // 要最近的 N 条但按 ASC 排列：用子查询
    sql = `SELECT * FROM (${sql.replace('ASC', 'DESC')} LIMIT ?) AS sub ORDER BY created_at ASC`;
    params.push(Number(limit));
  }

  const [rows] = await pool.query(sql, params);
  res.json(rows);
}));

app.delete('/api/logs', asyncHandler(async (_req, res) => {
  await pool.query('DELETE FROM logs');
  res.status(204).end();
}));

// ─── Settings ───

app.get('/api/settings', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
  const { id, updated_at, ...settings } = rows[0];
  res.json(settings);
}));

app.put('/api/settings', asyncHandler(async (req, res) => {
  const body = req.body;
  await pool.execute(
    `UPDATE settings SET
      strategy = ?, auto_rotation = ?, rest_after_tasks = ?, cooldown_minutes = ?,
      rate_limit_buffer = ?, max_concurrent_tasks = ?, global_rate_limit = ?,
      auto_retry = ?, max_retries = ?, task_timeout_minutes = ?, auto_dispatch = ?,
      openclaw_endpoint = ?, openclaw_api_key = ?, codex_path = ?, trae_path = ?,
      mode = ?, auto_launch = ?, auto_token_refresh = ?, token_refresh_interval_hours = ?,
      updated_at = NOW()
    WHERE id = 1`,
    [
      body.strategy,
      body.auto_rotation,
      body.rest_after_tasks,
      body.cooldown_minutes,
      body.rate_limit_buffer,
      body.max_concurrent_tasks,
      body.global_rate_limit,
      body.auto_retry,
      body.max_retries,
      body.task_timeout_minutes,
      body.auto_dispatch,
      body.openclaw_endpoint,
      body.openclaw_api_key,
      body.codex_path,
      body.trae_path,
      body.mode,
      body.auto_launch,
      body.auto_token_refresh ?? true,
      body.token_refresh_interval_hours ?? 72,
    ],
  );
  await createLog({ level: 'info', message: 'Settings updated' });
  res.json(body);
}));

// ─── Actions（使用轮换策略） ───

app.post('/api/actions/rotate', asyncHandler(async (_req, res) => {
  const [accounts] = await pool.query("SELECT * FROM accounts WHERE status != 'error' ORDER BY account_id ASC");
  if (accounts.length === 0) {
    return res.status(400).json({ message: 'No accounts available' });
  }

  const currentAccount = accounts.find(a => a.is_current);

  // 读取策略配置
  const [settingsRows] = await pool.query('SELECT strategy FROM settings WHERE id = 1');
  const strategy = settingsRows[0]?.strategy || 'round_robin';

  const nextAccount = pickNextAccount(accounts, currentAccount?.id, strategy);
  if (!nextAccount) {
    return res.status(400).json({ message: 'No alternative account available' });
  }

  await performAccountSwitch(nextAccount, `Rotated to ${nextAccount.account_id} (strategy: ${strategy})`);

  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [nextAccount.id]);
  res.json(mapAccount(rows[0]));
}));

app.post('/api/actions/pause-all', asyncHandler(async (_req, res) => {
  await pool.execute("UPDATE accounts SET status = 'idle', is_current = FALSE, updated_at = NOW()");
  await createLog({ level: 'warn', message: 'All accounts paused' });
  res.status(204).end();
}));

app.post('/api/actions/health-check', asyncHandler(async (_req, res) => {
  const [accounts] = await pool.query('SELECT * FROM accounts ORDER BY account_id ASC');
  const results = [];

  for (const account of accounts) {
    const authFilePath = expandPath(account.auth_file_path);
    let fileOk = false;
    let tokenValid = false;
    let tokenExpiresAt = null;

    // 1. 检查 auth 文件是否存在
    try {
      await fs.access(authFilePath);
      fileOk = true;
    } catch { /* file missing */ }

    // 2. 检查 token 是否过期
    if (fileOk) {
      try {
        const authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
        const accessToken = authData.tokens?.access_token;
        if (accessToken) {
          const payload = decodeJwtPayload(accessToken);
          if (payload?.exp) {
            tokenExpiresAt = new Date(payload.exp * 1000).toISOString();
            tokenValid = payload.exp * 1000 > Date.now();
          }
        }
      } catch { /* parse error */ }
    }

    // 3. 如果文件缺失或 token 已过期，标记为 error
    if (!fileOk || !tokenValid) {
      await pool.execute("UPDATE accounts SET status = 'error', updated_at = NOW() WHERE id = ?", [account.id]);
      await createLog({
        accountId: account.id,
        level: 'warn',
        message: `[健康检查] ${!fileOk ? 'Auth 文件不存在' : 'Token 已过期'}`,
      });
    } else if (account.status === 'error') {
      // token 有效但状态是 error，恢复为 idle
      await pool.execute("UPDATE accounts SET status = 'idle', updated_at = NOW() WHERE id = ?", [account.id]);
      await createLog({ accountId: account.id, message: '[健康检查] 状态已恢复' });
    }

    results.push({
      id: account.id,
      account_id: account.account_id,
      file_ok: fileOk,
      token_valid: tokenValid,
      token_expires_at: tokenExpiresAt,
    });
  }

  const healthy = results.filter(r => r.file_ok && r.token_valid).length;
  await createLog({ level: 'info', message: `[健康检查] ${healthy}/${results.length} 个账号健康` });
  res.json({ ok: true, total: results.length, healthy, accounts: results });
}));

// ─── 单个账号 Token 刷新 ───
app.post('/api/accounts/:id/refresh-token', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ message: '账号不存在' });

  const account = rows[0];
  if (isApiAccount(account)) {
    return res.status(400).json({ message: 'API 模式账号不支持刷新 Token' });
  }
  const result = await refreshTokenForAuthFile(account.auth_file_path);

  if (result.ok) {
    // 刷新成功，恢复状态
    if (account.status === 'error') {
      await pool.execute("UPDATE accounts SET status = 'idle', updated_at = NOW() WHERE id = ?", [id]);
    }
    await createLog({ accountId: id, message: `[Token 刷新] 成功，新过期时间: ${result.newExpiresAt}` });
    res.json({ ok: true, newExpiresAt: result.newExpiresAt });
  } else {
    await createLog({ accountId: id, level: 'warn', message: `[Token 刷新] 失败: ${result.reason}` });
    res.json({ ok: false, reason: result.reason });
  }
}));

// ─── 批量刷新所有 Token ───
app.post('/api/actions/refresh-all-tokens', asyncHandler(async (_req, res) => {
  const [accounts] = await pool.query('SELECT * FROM accounts ORDER BY account_id ASC');
  const results = [];

  for (const account of accounts) {
    if (isApiAccount(account)) {
      results.push({
        id: account.id,
        account_id: account.account_id,
        ok: false,
        reason: 'API 模式账号不支持刷新 Token',
        newExpiresAt: null,
      });
      continue;
    }
    const result = await refreshTokenForAuthFile(account.auth_file_path);
    if (result.ok) {
      if (account.status === 'error') {
        await pool.execute("UPDATE accounts SET status = 'idle', updated_at = NOW() WHERE id = ?", [account.id]);
      }
      await createLog({ accountId: account.id, message: `[批量刷新] Token 刷新成功` });
    } else {
      await createLog({ accountId: account.id, level: 'warn', message: `[批量刷新] 失败: ${result.reason}` });
    }
    results.push({
      id: account.id,
      account_id: account.account_id,
      ok: result.ok,
      reason: result.reason || null,
      newExpiresAt: result.newExpiresAt || null,
    });
  }

  const success = results.filter(r => r.ok).length;
  await createLog({ level: 'info', message: `[批量刷新] ${success}/${results.length} 个账号刷新成功` });

  // 同步当前活跃账号的新 token 到 OpenClaw
  const [currentRows] = await pool.query("SELECT * FROM accounts WHERE is_current = TRUE LIMIT 1");
  if (currentRows.length && !isApiAccount(currentRows[0]) && results.some(r => r.id === currentRows[0].id && r.ok)) {
    const authFilePath = expandPath(currentRows[0].auth_file_path);
    await syncOpenClawAuth(authFilePath);
    const reloadResult = await reloadOpenClaw();
    await createLog({ accountId: currentRows[0].id, message: `[批量刷新] 已同步 OpenClaw 并重载 (${reloadResult.method || reloadResult.reason})` });
  }

  res.json({ ok: true, total: results.length, success, results });
}));

// 手动重载/重启 OpenClaw
app.post('/api/actions/restart-openclaw', asyncHandler(async (_req, res) => {
  // 先确保 auth-profiles.json 是最新的
  const [activeRows] = await pool.query("SELECT * FROM accounts WHERE is_current = TRUE LIMIT 1");
  if (activeRows.length && !isApiAccount(activeRows[0])) {
    const authFilePath = expandPath(activeRows[0].auth_file_path);
    await syncOpenClawAuth(authFilePath);
  }

  const result = await reloadOpenClaw();
  await createLog({
    level: result.ok ? 'info' : 'warn',
    message: `[OpenClaw] 手动重载: ${result.ok ? result.method : result.reason}`,
  });
  res.json(result);
}));

// ─────────────────────────────────────────────
// 自动轮换：动态轮询 + 阈值触发切换
// ─────────────────────────────────────────────
let autoCheckTimer = null;
let lastAutoCheck = null; // { checked_at, account_id, primary_used, secondary_used }

/** 根据已用百分比决定下次检测间隔 */
function getCheckInterval(primaryUsed) {
  if (primaryUsed >= 80) return 5 * 60 * 1000;   // 5 分钟
  if (primaryUsed >= 50) return 10 * 60 * 1000;  // 10 分钟
  return 30 * 60 * 1000;                          // 30 分钟
}

async function runAutoCheck() {
  autoCheckTimer = null;
  let nextInterval = 30 * 60 * 1000;

  try {
    // 检查是否开启自动轮换
    const [settingsRows] = await pool.query('SELECT auto_rotation, strategy FROM settings WHERE id = 1');
    if (!settingsRows[0]?.auto_rotation) {
      autoCheckTimer = setTimeout(runAutoCheck, 60 * 1000); // 1分钟后再检查设置
      return;
    }
    const strategy = settingsRows[0].strategy || 'round_robin';

    // 获取当前活跃账号
    const [activeRows] = await pool.query("SELECT * FROM accounts WHERE is_current = TRUE LIMIT 1");
    if (!activeRows.length) {
      autoCheckTimer = setTimeout(runAutoCheck, nextInterval);
      return;
    }
    const account = activeRows[0];

    // 调用 API 获取用量
    const usage = await fetchUsageForAccount(account);
    if (!usage.ok && usage.error !== 'rate_limited') {
      autoCheckTimer = setTimeout(runAutoCheck, 10 * 60 * 1000);
      return;
    }

    const primary_used = usage.provider === 'api' ? 0 : (usage.primary_used ?? 100);
    const secondary_used = usage.secondary_used ?? 0;
    lastAutoCheck = { checked_at: new Date().toISOString(), account_id: account.account_id, primary_used, secondary_used };
    await createLog({ accountId: account.id, message: `[自动] 用量检测: 5h=${primary_used}% 周=${secondary_used}%` });

    // 5小时用量超过 90% → 自动切换（使用配置的策略）
    if (primary_used >= 90) {
      const [allAccounts] = await pool.query("SELECT * FROM accounts WHERE status != 'error' ORDER BY account_id ASC");
      const next = pickNextAccount(allAccounts, account.id, strategy);

      if (next) {
        await performAccountSwitch(next, `[自动轮换] ${account.account_id} 5h用量=${primary_used}%，已切换至 ${next.account_id} (strategy: ${strategy})`);
        nextInterval = 30 * 60 * 1000; // 切换后重置为 30 分钟
      }
    } else {
      nextInterval = getCheckInterval(primary_used);
    }
  } catch (err) {
    console.error('[自动轮换] 检测出错:', err.message);
    nextInterval = 10 * 60 * 1000;
  }

  autoCheckTimer = setTimeout(runAutoCheck, nextInterval);
}

// 查询自动轮换状态
app.get('/api/auto-check/status', (_req, res) => {
  res.json({ running: autoCheckTimer !== null, last_check: lastAutoCheck });
});

// ─────────────────────────────────────────────
// 自动 Token 刷新：定时批量刷新所有账号的 token
// ─────────────────────────────────────────────
let tokenRefreshTimer = null;
let lastTokenRefresh = null;

async function runAutoTokenRefresh() {
  tokenRefreshTimer = null;

  try {
    // 读取设置
    const [settingsRows] = await pool.query('SELECT auto_token_refresh, token_refresh_interval_hours FROM settings WHERE id = 1');
    const { auto_token_refresh, token_refresh_interval_hours } = settingsRows[0] || {};

    if (!auto_token_refresh) {
      // 未启用，1 小时后再检查
      tokenRefreshTimer = setTimeout(runAutoTokenRefresh, 60 * 60 * 1000);
      return;
    }

    const intervalMs = (token_refresh_interval_hours || 72) * 60 * 60 * 1000;

    // 如果距上次刷新未到间隔，跳过
    if (lastTokenRefresh && (Date.now() - lastTokenRefresh.getTime()) < intervalMs) {
      const remaining = intervalMs - (Date.now() - lastTokenRefresh.getTime());
      tokenRefreshTimer = setTimeout(runAutoTokenRefresh, Math.min(remaining + 1000, 60 * 60 * 1000));
      return;
    }

    // 执行批量刷新
    const [accounts] = await pool.query('SELECT * FROM accounts ORDER BY account_id ASC');
    let success = 0;

    let currentAccountRefreshed = false;
    const [currentRows] = await pool.query("SELECT id FROM accounts WHERE is_current = TRUE LIMIT 1");
    const currentAccountId = currentRows[0]?.id;

    for (const account of accounts) {
      if (isApiAccount(account)) {
        continue;
      }
      const result = await refreshTokenForAuthFile(account.auth_file_path);
      if (result.ok) {
        success++;
        if (account.status === 'error') {
          await pool.execute("UPDATE accounts SET status = 'idle', updated_at = NOW() WHERE id = ?", [account.id]);
        }
        if (account.id === currentAccountId) {
          currentAccountRefreshed = true;
        }
      } else {
        await createLog({ accountId: account.id, level: 'warn', message: `[自动刷新] 失败: ${result.reason}` });
      }
    }

    // 如果当前活跃账号的 token 被刷新了，同步到 OpenClaw 并重载
    if (currentAccountRefreshed && currentAccountId) {
      const [activeRows] = await pool.query("SELECT * FROM accounts WHERE id = ? LIMIT 1", [currentAccountId]);
      if (activeRows.length) {
        const authFilePath = expandPath(activeRows[0].auth_file_path);
        const syncResult = await syncOpenClawAuth(authFilePath);
        if (syncResult.ok) {
          const reloadResult = await reloadOpenClaw();
          await createLog({ accountId: currentAccountId, message: `[自动刷新] 已同步 OpenClaw 并重载 (${reloadResult.method || reloadResult.reason})` });
        }
      }
    }

    lastTokenRefresh = new Date();
    await createLog({
      level: success === accounts.length ? 'info' : 'warn',
      message: `[自动刷新] ${success}/${accounts.length} 个账号 Token 刷新成功`,
    });

    // 下次检查
    tokenRefreshTimer = setTimeout(runAutoTokenRefresh, intervalMs);
  } catch (err) {
    await createLog({ level: 'error', message: `[自动刷新] 出错: ${err.message}` });
    // 出错后 30 分钟重试
    tokenRefreshTimer = setTimeout(runAutoTokenRefresh, 30 * 60 * 1000);
  }
}

// 查询自动刷新状态
app.get('/api/auto-refresh/status', (_req, res) => {
  res.json({ running: tokenRefreshTimer !== null, last_refresh: lastTokenRefresh });
});

// 读取本地 ~/.codex/sessions/ 获取最近的 Codex 用量数据（5h / 周）
app.get('/api/codex-usage', asyncHandler(async (_req, res) => {
  const sessionsDir = path.join(os.homedir(), '.codex', 'sessions');

  try {
    await fs.access(sessionsDir);
  } catch {
    return res.json({ found: false, reason: 'sessions_dir_not_found' });
  }

  // 倒序扫描最近 7 天，找最新的含 rate_limits 的 token_count 事件
  const now = new Date();
  let latestEvent = null;
  let latestTimestamp = null;

  outer:
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const d = new Date(now.getTime() - dayOffset * 86400000);
    const year = d.getFullYear().toString();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dirPath = path.join(sessionsDir, year, month, day);

    try {
      await fs.access(dirPath);
    } catch {
      continue;
    }

    // 按文件名倒序（最新文件优先）
    const entries = await fs.readdir(dirPath);
    const files = entries.filter(f => f.endsWith('.jsonl')).sort().reverse();

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      let content;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n').filter(Boolean).reverse();

      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (
            record.type === 'event_msg' &&
            record.payload?.type === 'token_count' &&
            record.payload?.rate_limits != null
          ) {
            const ts = new Date(record.timestamp);
            if (!latestTimestamp || ts > latestTimestamp) {
              latestTimestamp = ts;
              latestEvent = record;
            }
            break;
          }
        } catch { /* 跳过无效行 */ }
      }

      if (latestEvent) break outer;
    }
  }

  if (!latestEvent) {
    return res.json({ found: false, reason: 'no_rate_limit_data' });
  }

  const { primary, secondary } = latestEvent.payload.rate_limits;
  const recordedAt = latestEvent.timestamp;
  const recordedAtMs = new Date(recordedAt).getTime();

  const primaryResetsAt = primary?.resets_in_seconds != null
    ? new Date(recordedAtMs + primary.resets_in_seconds * 1000).toISOString()
    : null;
  const secondaryResetsAt = secondary?.resets_in_seconds != null
    ? new Date(recordedAtMs + secondary.resets_in_seconds * 1000).toISOString()
    : null;

  const tokenUsage = latestEvent.payload?.info?.total_token_usage ?? null;

  res.json({
    found: true,
    recorded_at: recordedAt,
    primary: primary ? {
      used_percent: primary.used_percent,
      window_minutes: primary.window_minutes,
      resets_at: primaryResetsAt,
    } : null,
    secondary: secondary ? {
      used_percent: secondary.used_percent,
      window_minutes: secondary.window_minutes,
      resets_at: secondaryResetsAt,
    } : null,
    token_usage: tokenUsage,
  });
}));

// ─── Error handler ───

app.use((error, req, res, _next) => {
  const status = error.status || error.statusCode || 500;
  console.error(`[ERROR] ${req.method} ${req.path}:`, error.message);
  if (status === 500) console.error(error.stack);

  // 异步记录到数据库（不阻塞响应）
  createLog({ level: 'error', message: `[${req.method} ${req.path}] ${error.message}` }).catch(() => {});

  if (!res.headersSent) {
    res.status(status).json({ message: error.message || 'Unexpected server error' });
  }
});

// ─────────────────────────────────────────────
// 启动 + 优雅关闭
// ─────────────────────────────────────────────

let server;

async function start() {
  await initDatabase();
  server = app.listen(config.port, () => {
    console.log(`API server listening on http://localhost:${config.port}`);
  });
  // 启动自动轮换检测（延迟 10 秒等数据库就绪）
  setTimeout(runAutoCheck, 10 * 1000);
  // 启动自动 Token 刷新（延迟 30 秒）
  setTimeout(runAutoTokenRefresh, 30 * 1000);
  // 启动 auth-profiles.json 文件监控
  await startAuthFileWatcher();
}

async function shutdown(signal) {
  console.log(`\n[${signal}] 正在关闭服务器...`);
  if (autoCheckTimer) {
    clearTimeout(autoCheckTimer);
    autoCheckTimer = null;
  }
  if (tokenRefreshTimer) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }
  if (authFileWatcher) {
    authFileWatcher.close();
    authFileWatcher = null;
  }
  if (server) {
    server.close(() => console.log('HTTP 服务器已关闭'));
  }
  try {
    await pool.end();
    console.log('数据库连接池已关闭');
  } catch (err) {
    console.error('关闭数据库连接池出错:', err.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
