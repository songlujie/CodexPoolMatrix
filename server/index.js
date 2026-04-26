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
import { PassThrough } from 'stream';
import { promisify } from 'util';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { config } from './config.js';
import { initDatabase } from './init-db.js';
import { pool } from './db.js';
import { createAccountsService } from './services/accounts-service.js';
import { createAccountRuntimeService } from './services/account-runtime-service.js';
import { createAuthRuntimeService } from './services/auth-runtime-service.js';
import { createCodexReadService } from './services/codex-read-service.js';
import { createLog } from './services/log-service.js';
import { addPlatform, listPlatforms, removePlatform } from './services/platforms-service.js';
import { getSettings, updateSettings } from './services/settings-service.js';
import { batchCancelTasks, batchRetryTasks, createTask, listTasks } from './services/tasks-service.js';

// 项目根目录（server/ 的上一层）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PROJECT_ACCOUNTS_DIR = path.join(PROJECT_ROOT, 'accounts');
const FRONTEND_DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const FRONTEND_INDEX_PATH = path.join(FRONTEND_DIST_DIR, 'index.html');
const DESKTOP_ACCOUNTS_DIR = process.env.DESKTOP_ACCOUNTS_DIR?.trim()
  ? path.resolve(process.env.DESKTOP_ACCOUNTS_DIR.trim())
  : path.join(path.dirname(config.db.sqlitePath), 'accounts');
const DEFAULT_ACCOUNTS_DIR = process.env.DESKTOP_RUNTIME === '1'
  ? DESKTOP_ACCOUNTS_DIR
  : PROJECT_ACCOUNTS_DIR;

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

async function getSelectedRuntimeMode() {
  return 'codex';
}

const CODEX_HOME_DIR = path.join(os.homedir(), '.codex');
const CODEX_CONFIG_PATH = path.join(CODEX_HOME_DIR, 'config.toml');
const CODEX_AUTH_PATH = path.join(CODEX_HOME_DIR, 'auth.json');
const CODEX_MATRIX_STATE_PATH = path.join(CODEX_HOME_DIR, 'matrix-cli-state.json');
const CODEX_MATRIX_PROVIDER = 'custom';
const CODEX_MATRIX_MANAGED_START = '# >>> CODEX MATRIX MANAGED START';
const CODEX_MATRIX_MANAGED_END = '# <<< CODEX MATRIX MANAGED END';
const CLAUDE_HOME_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_PATH = path.join(CLAUDE_HOME_DIR, 'settings.json');
const CLAUDE_MATRIX_STATE_PATH = path.join(CLAUDE_HOME_DIR, 'matrix-cli-state.json');

function normalizeRuntimeMode(mode = 'codex') {
  return mode === 'trae' || mode === 'claude' ? 'claude' : 'codex';
}

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
    const line = lines[index].replace(/\s+$/g, '');
    const trimmed = stripTomlLineComment(line).trim();

    if (!trimmed) {
      kept.push(line);
      continue;
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || key === 'base_url' || seenKeys.has(key)) {
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

function createConfigValidationError(message, details = {}) {
  const error = new Error(message);
  error.status = 400;
  Object.assign(error, details);
  return error;
}

function stripTomlLineComment(line = '') {
  let result = '';
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (inDouble) {
      result += char;
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inSingle) {
      result += char;
      if (char === '\'') {
        inSingle = false;
      }
      continue;
    }

    if (char === '#') {
      break;
    }

    result += char;
    if (char === '"') {
      inDouble = true;
    } else if (char === '\'') {
      inSingle = true;
    }
  }

  return result;
}

function validateApiCliConfigSnippet(snippet = '') {
  return sanitizeApiCliConfigSnippet(snippet);
}

function validateTomlForDuplicateKeys(content = '', fileLabel = 'config.toml') {
  return { ok: true, fileLabel, content };
}

function stripTomlTableBlocks(content = '', tableName = '') {
  const lines = String(content || '').split(/\r?\n/);
  const kept = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = stripTomlLineComment(line).trim();
    const tableMatch = trimmed.match(/^\[(.+)\]$/);
    const arrayTableMatch = trimmed.match(/^\[\[(.+)\]\]$/);

    if (tableMatch || arrayTableMatch) {
      const nextTableName = (tableMatch?.[1] || arrayTableMatch?.[1] || '').trim();
      skipping = nextTableName === tableName;
      if (!skipping) {
        kept.push(line);
      }
      continue;
    }

    if (!skipping) {
      kept.push(line);
    }
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
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
  const customConfig = validateApiCliConfigSnippet(account.api_cli_config);

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
  const cleanConfig = stripTomlTableBlocks(
    stripManagedCodexConfigBlock(currentConfig),
    `model_providers.${CODEX_MATRIX_PROVIDER}`,
  );
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
  validateTomlForDuplicateKeys(nextConfig, CODEX_CONFIG_PATH);

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

function normalizeClaudeBaseUrl(baseUrl = '') {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function ensurePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

async function readClaudeSettings() {
  try {
    const raw = await fs.readFile(CLAUDE_SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return ensurePlainObject(parsed);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeClaudeSettings(settings) {
  await fs.mkdir(CLAUDE_HOME_DIR, { recursive: true });
  await fs.writeFile(CLAUDE_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

async function readClaudeMatrixState() {
  try {
    const raw = await fs.readFile(CLAUDE_MATRIX_STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeClaudeMatrixState(payload) {
  await fs.mkdir(CLAUDE_HOME_DIR, { recursive: true });
  await fs.writeFile(CLAUDE_MATRIX_STATE_PATH, JSON.stringify(payload, null, 2));
}

async function captureClaudePreviousState() {
  const settings = await readClaudeSettings();
  const env = ensurePlainObject(settings.env);
  return {
    env: {
      ANTHROPIC_AUTH_TOKEN: String(env.ANTHROPIC_AUTH_TOKEN || '').trim() || null,
      ANTHROPIC_BASE_URL: normalizeClaudeBaseUrl(env.ANTHROPIC_BASE_URL || '') || null,
      ANTHROPIC_MODEL: String(env.ANTHROPIC_MODEL || '').trim() || null,
    },
  };
}

function restoreClaudeEnvVariable(env, key, value) {
  if (typeof value === 'string' && value.trim()) {
    env[key] = value;
    return;
  }
  delete env[key];
}

async function activateClaudeApiProvider(account) {
  const currentSettings = await readClaudeSettings();
  const existingState = await readClaudeMatrixState();
  const previous = existingState?.previous || await captureClaudePreviousState();
  const nextSettings = ensurePlainObject(currentSettings);
  const nextEnv = ensurePlainObject(nextSettings.env);
  const apiBaseUrl = normalizeClaudeBaseUrl(account.api_base_url);
  const apiModel = String(account.api_model || '').trim();

  nextEnv.ANTHROPIC_AUTH_TOKEN = String(account.api_key || '').trim();
  if (apiBaseUrl) {
    nextEnv.ANTHROPIC_BASE_URL = apiBaseUrl;
  } else {
    delete nextEnv.ANTHROPIC_BASE_URL;
  }

  if (apiModel) {
    nextEnv.ANTHROPIC_MODEL = apiModel;
  } else {
    delete nextEnv.ANTHROPIC_MODEL;
  }

  nextSettings.env = nextEnv;
  await writeClaudeSettings(nextSettings);
  await writeClaudeMatrixState({
    mode: 'api',
    account_id: account.account_id,
    email: account.email || null,
    api_base_url: apiBaseUrl || null,
    api_model: apiModel || null,
    previous,
  });
}

async function activateClaudeOAuthProvider(account) {
  const currentSettings = await readClaudeSettings();
  const existingState = await readClaudeMatrixState();
  const previous = existingState?.previous || await captureClaudePreviousState();
  const nextSettings = ensurePlainObject(currentSettings);
  const nextEnv = ensurePlainObject(nextSettings.env);

  restoreClaudeEnvVariable(nextEnv, 'ANTHROPIC_AUTH_TOKEN', previous.env?.ANTHROPIC_AUTH_TOKEN);
  restoreClaudeEnvVariable(nextEnv, 'ANTHROPIC_BASE_URL', previous.env?.ANTHROPIC_BASE_URL);
  restoreClaudeEnvVariable(nextEnv, 'ANTHROPIC_MODEL', previous.env?.ANTHROPIC_MODEL);

  if (Object.keys(nextEnv).length > 0) {
    nextSettings.env = nextEnv;
  } else {
    delete nextSettings.env;
  }

  await writeClaudeSettings(nextSettings);
  await writeClaudeMatrixState({
    mode: 'oauth',
    account_id: account.account_id,
    email: account.email || null,
    auth_file_path: account.auth_file_path || null,
    oauth_supported: false,
    previous,
  });
}

async function activateApiProviderForMode(account, runtimeMode) {
  if (normalizeRuntimeMode(runtimeMode) === 'claude') {
    await activateClaudeApiProvider(account);
    return;
  }

  await activateCodexApiProvider(account);
}

async function activateOAuthProviderForMode(account, runtimeMode) {
  if (normalizeRuntimeMode(runtimeMode) === 'claude') {
    await activateClaudeOAuthProvider(account);
    return;
  }

  await restoreCodexOAuthProvider();
  await authRuntimeService.switchAuthFile(account.auth_file_path);
}

async function activateApiProviderForCurrentMode(account) {
  const runtimeMode = await getSelectedRuntimeMode();
  await activateApiProviderForMode(account, runtimeMode);
}

async function validateCodexApiConfig(account) {
  const currentConfig = await readCodexConfigText();
  const cleanConfig = stripTomlTableBlocks(
    stripManagedCodexConfigBlock(currentConfig),
    `model_providers.${CODEX_MATRIX_PROVIDER}`,
  );
  let nextConfig = cleanConfig;

  nextConfig = upsertTopLevelTomlString(nextConfig, 'model_provider', CODEX_MATRIX_PROVIDER);
  nextConfig = upsertTopLevelTomlString(nextConfig, 'model', String(account.api_model || '').trim() || 'gpt-5.4');
  nextConfig = upsertTopLevelTomlString(nextConfig, 'model_reasoning_effort', 'medium');
  nextConfig = upsertTopLevelTomlLiteral(nextConfig, 'disable_response_storage', 'true');
  nextConfig = `${nextConfig.trimEnd()}\n\n${buildManagedCodexProviderBlock(account)}`;

  validateTomlForDuplicateKeys(nextConfig, CODEX_CONFIG_PATH);

  return {
    ok: true,
    sanitized: validateApiCliConfigSnippet(account.api_cli_config),
    preview: `${nextConfig.trimEnd()}\n`,
  };
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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const OPENCLAW_AUTH_PATH = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');

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
              await authRuntimeService.syncOpenClawAuth(authFilePath);
              // 再次重载 OpenClaw
              await authRuntimeService.reloadOpenClaw();
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

const codexReadService = createCodexReadService({
  fs,
  pool,
  mapAccount,
  getSelectedRuntimeMode,
  readCodexMatrixState,
  readCodexConfigText,
  detectCodexManagedProvider,
  readClaudeMatrixState,
  readClaudeSettings,
  normalizeClaudeBaseUrl,
  getAuthIdentity,
  codePaths: {
    authPath: CODEX_AUTH_PATH,
    configPath: CODEX_CONFIG_PATH,
    claudeSettingsPath: CLAUDE_SETTINGS_PATH,
  },
  isApiAccount,
});

const accountsService = createAccountsService({
  fs,
  path,
  pool,
  createLog,
  mapAccount,
  expandPath,
  requestJson,
  getAuthIdentity,
  buildAuthStorageFileName,
  sanitizeApiCliConfigSnippet,
  validateApiCliConfigSnippet,
  activateApiProviderForCurrentMode,
  validateCodexApiConfig,
  buildManagedCodexProviderBlock,
  isApiAccount,
  decodeJwtPayload,
});

const authRuntimeService = createAuthRuntimeService({
  fs,
  path,
  os,
  exec,
  spawn,
  execAsync,
  requestJson,
  decodeJwtPayload,
  expandPath,
  getAuthIdentity,
  buildAuthStorageFileName,
  projectAccountsDir: DEFAULT_ACCOUNTS_DIR,
  codexHomeDir: CODEX_HOME_DIR,
  codexAuthPath: CODEX_AUTH_PATH,
  stripAnsi,
  shouldUseShellForBinary,
  getCodexCommandEnv,
  isWindowsStoreBinary,
  pool,
  createLog,
});

const accountRuntimeService = createAccountRuntimeService({
  fs,
  pool,
  createLog,
  isApiAccount,
  getSelectedRuntimeMode,
  activateApiProviderForMode,
  activateOAuthProviderForMode,
  expandPath,
  decodeJwtPayload,
  setExpectedAccountId,
  reloadOpenClaw: authRuntimeService.reloadOpenClaw,
  requestJson,
  normalizeApiBaseUrl,
  buildRelayUrl,
});

// ─── Health ───

app.get('/api/health', asyncHandler(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

app.get('/api/codex/current-auth', asyncHandler(async (_req, res) => {
  res.json(await codexReadService.getCurrentAuth());
}));

app.get('/api/codex/managed-status', asyncHandler(async (_req, res) => {
  res.json(await codexReadService.getManagedStatus());
}));

// ─── Accounts ───

app.get('/api/accounts', asyncHandler(async (_req, res) => {
  res.json(await accountsService.listAccounts());
}));

// 扫描目录，自动发现 auth 文件
app.get('/api/accounts/scan-dir', asyncHandler(async (req, res) => {
  const dir = req.query.dir ? expandPath(req.query.dir) : DEFAULT_ACCOUNTS_DIR;
  res.json(await accountsService.scanAccountsDir(dir));
}));

app.post('/api/accounts', asyncHandler(async (req, res) => {
  res.status(201).json(await accountsService.createAccount(req.body));
}));

app.patch('/api/accounts/:id', asyncHandler(async (req, res) => {
  res.json(mapAccount(await accountRuntimeService.updateAccountAction(req.params.id, req.body?.action)));
}));

app.put('/api/accounts/:id/api-cli-config', asyncHandler(async (req, res) => {
  res.json(await accountsService.updateApiCliConfig(req.params.id, req.body?.api_cli_config));
}));

app.post('/api/accounts/:id/api-cli-config/preview', asyncHandler(async (req, res) => {
  res.json(await accountsService.previewApiCliConfig(req.params.id, req.body?.api_cli_config));
}));

app.delete('/api/accounts/:id', asyncHandler(async (req, res) => {
  await accountsService.deleteAccount(req.params.id);
  res.status(204).end();
}));

// 清空所有账号（用于清除假数据）
app.delete('/api/accounts', asyncHandler(async (_req, res) => {
  await accountsService.clearAllAccounts();
  res.status(204).end();
}));

// 读取账号 auth 文件，解析邮箱 / 套餐 / token 有效期 / OpenAI 用量
app.get('/api/accounts/:id/auth-info', asyncHandler(async (req, res) => {
  res.json(await accountsService.getAccountAuthInfo(req.params.id));
}));

// 检测账号可用性 + 获取实时用量（共用 handleUsageCheck）
app.post('/api/accounts/:id/check-usage', asyncHandler(async (req, res) => {
  const result = await accountRuntimeService.handleUsageCheck(req.params.id);
  const httpStatus = result._status || 200;
  delete result._status;
  res.status(httpStatus).json(result);
}));

// 刷新用量（转发到共用逻辑）
app.post('/api/accounts/:id/refresh-codex-usage', asyncHandler(async (req, res) => {
  const result = await accountRuntimeService.handleUsageCheck(req.params.id);
  const httpStatus = result._status || 200;
  delete result._status;
  res.status(httpStatus).json(result);
}));

// ─── Platforms ───

app.get('/api/platforms', asyncHandler(async (_req, res) => {
  res.json(await listPlatforms());
}));

app.post('/api/platforms', asyncHandler(async (req, res) => {
  res.status(201).json(await addPlatform(req.body?.name));
}));

app.delete('/api/platforms/:name', asyncHandler(async (req, res) => {
  res.json(await removePlatform(req.params.name));
}));

// ─── Codex Login ───

app.post('/api/auth/codex-login', asyncHandler(async (_req, res) => {
  res.json(await authRuntimeService.startCodexLogin());
}));

app.get('/api/auth/codex-login/status', asyncHandler(async (_req, res) => {
  res.json(authRuntimeService.getCodexLoginStatus());
}));

app.delete('/api/auth/codex-login', asyncHandler(async (_req, res) => {
  res.json(authRuntimeService.cancelCodexLogin());
}));

// ─── Tasks ───

app.get('/api/tasks', asyncHandler(async (_req, res) => {
  res.json((await listTasks()).map(mapTask));
}));

app.post('/api/tasks', asyncHandler(async (req, res) => {
  res.status(201).json(mapTask(await createTask(req.body)));
}));

app.post('/api/tasks/batch-retry', asyncHandler(async (req, res) => {
  res.json(await batchRetryTasks(req.body?.ids || []));
}));

app.post('/api/tasks/batch-cancel', asyncHandler(async (req, res) => {
  res.json(await batchCancelTasks(req.body?.ids || []));
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
  res.json(await getSettings());
}));

app.put('/api/settings', asyncHandler(async (req, res) => {
  const previousMode = await getSelectedRuntimeMode();
  const nextSettings = await updateSettings(req.body);
  const nextMode = normalizeRuntimeMode(nextSettings.mode);

  if (previousMode !== nextMode) {
    const [currentRows] = await pool.query("SELECT * FROM accounts WHERE is_current = TRUE LIMIT 1");
    if (currentRows[0]) {
      await accountRuntimeService.syncRuntimeForAccount(
        currentRows[0],
        `Runtime switched to ${nextMode} for ${currentRows[0].account_id}`,
      );
    }
  }

  res.json(nextSettings);
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

  await accountRuntimeService.performAccountSwitch(nextAccount, `Rotated to ${nextAccount.account_id} (strategy: ${strategy})`);

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
  const result = await authRuntimeService.refreshTokenForAuthFile(account.auth_file_path);

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
    const result = await authRuntimeService.refreshTokenForAuthFile(account.auth_file_path);
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
    await authRuntimeService.syncOpenClawAuth(authFilePath);
    const reloadResult = await authRuntimeService.reloadOpenClaw();
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
    await authRuntimeService.syncOpenClawAuth(authFilePath);
  }

  const result = await authRuntimeService.reloadOpenClaw();
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
    const usage = await accountRuntimeService.fetchUsageForAccount(account);
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
        await accountRuntimeService.performAccountSwitch(next, `[自动轮换] ${account.account_id} 5h用量=${primary_used}%，已切换至 ${next.account_id} (strategy: ${strategy})`);
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
      const result = await authRuntimeService.refreshTokenForAuthFile(account.auth_file_path);
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
        const syncResult = await authRuntimeService.syncOpenClawAuth(authFilePath);
        if (syncResult.ok) {
          const reloadResult = await authRuntimeService.reloadOpenClaw();
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

if (fsSync.existsSync(FRONTEND_INDEX_PATH)) {
  app.use(express.static(FRONTEND_DIST_DIR));
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(FRONTEND_INDEX_PATH);
  });
}

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
let serverStartPromise = null;
let runtimeReadyPromise = null;
let runtimeStarted = false;

async function ensureRuntimeReady() {
  if (runtimeStarted) {
    return;
  }

  if (runtimeReadyPromise) {
    return runtimeReadyPromise;
  }

  runtimeReadyPromise = (async () => {
    await initDatabase();
    await fs.mkdir(DEFAULT_ACCOUNTS_DIR, { recursive: true });

    // 后台任务只初始化一次，桌面 IPC 和 HTTP 模式共用同一套运行时。
    setTimeout(runAutoCheck, 10 * 1000);
    setTimeout(runAutoTokenRefresh, 30 * 1000);
    await startAuthFileWatcher();

    runtimeStarted = true;
  })();

  try {
    await runtimeReadyPromise;
  } finally {
    runtimeReadyPromise = null;
  }
}

export async function startDesktopRuntime() {
  await ensureRuntimeReady();
}

function createMockRequest({ method = 'GET', requestPath = '/', headers = {}, body } = {}) {
  const req = new PassThrough();
  const boundMethods = [
    '_destroy',
    '_final',
    '_flush',
    '_read',
    '_transform',
    '_write',
    '_writev',
    'cork',
    'destroy',
    'emit',
    'end',
    'off',
    'on',
    'once',
    'pause',
    'pipe',
    'push',
    'read',
    'removeListener',
    'resume',
    'uncork',
    'unpipe',
    'write',
  ];
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );

  const payload = body == null
    ? null
    : Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));

  if (payload && !normalizedHeaders['content-length']) {
    normalizedHeaders['content-length'] = String(payload.length);
  }
  if (payload && !normalizedHeaders['content-type']) {
    normalizedHeaders['content-type'] = 'application/json';
  }

  req.method = String(method || 'GET').toUpperCase();
  req.url = requestPath;
  req.originalUrl = requestPath;
  req.headers = normalizedHeaders;
  req.connection = req.socket = {
    remoteAddress: '127.0.0.1',
    encrypted: false,
    readable: true,
    writable: true,
    destroy() {},
    on() {},
    once() {},
    removeListener() {},
  };
  req.httpVersion = '1.1';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;

  for (const methodName of boundMethods) {
    if (typeof req[methodName] === 'function') {
      req[methodName] = req[methodName].bind(req);
    }
  }

  process.nextTick(() => {
    if (payload) {
      req.end(payload);
      return;
    }
    req.end();
  });

  return req;
}

function createMockResponse(resolve, reject) {
  const res = new PassThrough();
  const chunks = [];
  const responseHeaders = new Map();

  res.locals = {};
  res.statusCode = 200;
  res.headersSent = false;
  res.finished = false;

  res.setHeader = (name, value) => {
    responseHeaders.set(String(name).toLowerCase(), value);
  };
  res.getHeader = (name) => responseHeaders.get(String(name).toLowerCase());
  res.getHeaders = () => Object.fromEntries(responseHeaders.entries());
  res.removeHeader = (name) => {
    responseHeaders.delete(String(name).toLowerCase());
  };
  res.writeHead = (statusCode, headers = {}) => {
    res.statusCode = statusCode;
    Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
    res.headersSent = true;
    return res;
  };
  res.write = (chunk) => {
    if (chunk != null) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    res.headersSent = true;
    return true;
  };
  res.end = (chunk) => {
    if (chunk != null) {
      res.write(chunk);
    }

    res.headersSent = true;
    res.finished = true;

    const bodyBuffer = chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
    const contentType = String(res.getHeader('content-type') || '');
    const bodyText = bodyBuffer.toString('utf8');
    let data = bodyText;

    if (contentType.includes('application/json')) {
      try {
        data = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        data = bodyText;
      }
    }

    resolve({
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      headers: res.getHeaders(),
      data,
    });
  };
  res.on('error', reject);

  return res;
}

export async function invokeApiRequest({
  method = 'GET',
  path: requestPath = '/',
  headers = {},
  body,
  query,
} = {}) {
  await ensureRuntimeReady();

  const search = query ? new URLSearchParams(query).toString() : '';
  const url = `${requestPath}${search ? `?${search}` : ''}`;

  return new Promise((resolve, reject) => {
    const req = createMockRequest({ method, requestPath: url, headers, body });
    const res = createMockResponse(resolve, reject);

    app.handle(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }

      if (!res.finished) {
        res.end();
      }
    });
  });
}

export async function startServer() {
  if (server) {
    return server;
  }

  if (serverStartPromise) {
    return serverStartPromise;
  }

  serverStartPromise = (async () => {
    await ensureRuntimeReady();

    await new Promise((resolve, reject) => {
      server = app.listen(config.port, config.host, () => {
        console.log(`API server listening on http://${config.host}:${config.port}`);
        resolve();
      });
      server.on('error', reject);
    });

    return server;
  })();

  try {
    return await serverStartPromise;
  } finally {
    serverStartPromise = null;
  }
}

export async function stopServer() {
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
    await new Promise((resolve) => {
      server.close(() => {
        console.log('HTTP 服务器已关闭');
        resolve();
      });
    });
    server = null;
  }
  try {
    await pool.end();
    console.log('数据库连接池已关闭');
  } catch (err) {
    console.error('关闭数据库连接池出错:', err.message);
  }
  runtimeStarted = false;
}

async function shutdown(signal) {
  console.log(`\n[${signal}] 正在关闭服务器...`);
  await stopServer();
  process.exit(0);
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

if (isDirectRun) {
  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });

  startServer().catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
}
