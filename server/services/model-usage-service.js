function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function truncateText(value, maxLength = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function extractMessageText(content = []) {
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      if (typeof item.text === 'string') return item.text;
      if (typeof item.output === 'string') return item.output;
      if (typeof item.input === 'string') return item.input;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function getTokenValue(tokenUsage, key) {
  const value = Number(tokenUsage?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function buildEmptySummary() {
  return {
    total_calls: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
}

function summarizeCalls(items = []) {
  return items.reduce((accumulator, item) => ({
    total_calls: accumulator.total_calls + 1,
    input_tokens: accumulator.input_tokens + item.input_tokens,
    cached_input_tokens: accumulator.cached_input_tokens + item.cached_input_tokens,
    output_tokens: accumulator.output_tokens + item.output_tokens,
    reasoning_output_tokens: accumulator.reasoning_output_tokens + item.reasoning_output_tokens,
    total_tokens: accumulator.total_tokens + item.total_tokens,
  }), buildEmptySummary());
}

export function createModelUsageService({ fs, path, os }) {
  const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
  const matrixStatePath = path.join(os.homedir(), '.codex', 'matrix-cli-state.json');
  const sessionFileCache = new Map();
  const modelCallsCache = new Map();
  const latestUsageCache = new Map();

  async function readCurrentAccountName() {
    try {
      const raw = await fs.readFile(matrixStatePath, 'utf8');
      const parsed = JSON.parse(raw);
      return String(parsed?.account_id || '').trim() || null;
    } catch {
      return null;
    }
  }

  function buildEntriesSignature(entries = []) {
    return entries
      .map((entry) => `${entry.filePath}:${entry.mtimeMs}`)
      .join('|');
  }

  async function listSessionEntries(days = 7) {
    const entries = [];
    const now = new Date();

    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const current = new Date(now.getTime() - dayOffset * 86400000);
      const year = current.getFullYear().toString();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      const dirPath = path.join(sessionsRoot, year, month, day);

      try {
        await fs.access(dirPath);
      } catch {
        continue;
      }

      const dirEntries = await fs.readdir(dirPath);
      const dayFiles = dirEntries
        .filter((entry) => entry.endsWith('.jsonl'))
        .sort()
        .reverse()
        .map((entry) => path.join(dirPath, entry));

      for (const filePath of dayFiles) {
        try {
          const stat = await fs.stat(filePath);
          entries.push({ filePath, mtimeMs: stat.mtimeMs });
        } catch {
          // ignore files deleted between readdir and stat
        }
      }
    }

    return entries;
  }

  async function findLatestTokenCountEvent(days = 7) {
    const entries = await listSessionEntries(days);

    for (const { filePath } of entries) {
      let content;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch {
        continue;
      }

      const lines = content.split('\n').filter(Boolean).reverse();
      let sessionMeta = null;

      for (const line of lines) {
        const record = safeJsonParse(line);
        if (!record) continue;

        if (!sessionMeta && record.type === 'session_meta') {
          sessionMeta = record;
        }

        if (record.type === 'event_msg' && record.payload?.type === 'token_count') {
          return { filePath, sessionMeta, record };
        }
      }
    }

    return null;
  }

  async function parseSessionFile(filePath) {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return [];
    }

    const cached = sessionFileCache.get(filePath);
    if (cached?.mtimeMs === stat.mtimeMs) {
      return cached.items;
    }

    let content;

    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      return [];
    }

    const items = [];
    const lines = content.split('\n').filter(Boolean);
    let sessionMeta = null;
    let currentTurnId = null;
    let turnSequence = 0;
    const turnContextById = new Map();
    const turnStateById = new Map();

    const getTurnState = (turnId) => {
      if (!turnId) return null;

      if (!turnStateById.has(turnId)) {
        turnSequence += 1;
        turnStateById.set(turnId, {
          turn_index: turnSequence,
          input_preview: '',
          assistant_preview: '',
          agent_message: '',
          tool_name: '',
          phase: '',
        });
      }

      return turnStateById.get(turnId);
    };

    for (const line of lines) {
      const record = safeJsonParse(line);
      if (!record) continue;

      if (record.type === 'session_meta') {
        sessionMeta = record;
        continue;
      }

      if (record.type === 'turn_context') {
        const turnId = record.payload?.turn_id || null;
        if (turnId) {
          turnContextById.set(turnId, record.payload || {});
          currentTurnId = turnId;
          getTurnState(turnId);
        }
        continue;
      }

      if (record.type === 'event_msg') {
        const payloadType = record.payload?.type;

        if (payloadType === 'task_started') {
          currentTurnId = record.payload?.turn_id || currentTurnId;
          getTurnState(currentTurnId);
          continue;
        }

        if (payloadType === 'agent_message') {
          const state = getTurnState(currentTurnId);
          if (state) {
            state.agent_message = truncateText(record.payload?.message || '');
            state.phase = record.payload?.phase || state.phase;
          }
          continue;
        }

        if (payloadType === 'token_count') {
          const tokenUsage = record.payload?.info?.last_token_usage || {};
          const totalUsage = record.payload?.info?.total_token_usage || {};
          const context = turnContextById.get(currentTurnId) || {};
          const state = getTurnState(currentTurnId);

          items.push({
            id: `${record.timestamp || 'unknown'}:${items.length}`,
            timestamp: record.timestamp || null,
            session_id: sessionMeta?.payload?.id || path.basename(filePath, '.jsonl'),
            session_file: filePath,
            turn_id: currentTurnId || null,
            turn_index: state?.turn_index || null,
            model: context.model || null,
            model_provider: sessionMeta?.payload?.model_provider || null,
            cwd: context.cwd || sessionMeta?.payload?.cwd || null,
            phase: state?.phase || null,
            summary: truncateText(
              state?.input_preview ||
              state?.assistant_preview ||
              state?.agent_message ||
              (state?.tool_name ? `Tool: ${state.tool_name}` : ''),
            ),
            input_tokens: getTokenValue(tokenUsage, 'input_tokens'),
            cached_input_tokens: getTokenValue(tokenUsage, 'cached_input_tokens'),
            output_tokens: getTokenValue(tokenUsage, 'output_tokens'),
            reasoning_output_tokens: getTokenValue(tokenUsage, 'reasoning_output_tokens'),
            total_tokens: getTokenValue(tokenUsage, 'total_tokens'),
            cumulative_input_tokens: getTokenValue(totalUsage, 'input_tokens'),
            cumulative_cached_input_tokens: getTokenValue(totalUsage, 'cached_input_tokens'),
            cumulative_output_tokens: getTokenValue(totalUsage, 'output_tokens'),
            cumulative_reasoning_output_tokens: getTokenValue(totalUsage, 'reasoning_output_tokens'),
            cumulative_total_tokens: getTokenValue(totalUsage, 'total_tokens'),
            model_context_window: Number(record.payload?.info?.model_context_window || 0) || null,
          });
        }

        continue;
      }

      if (record.type !== 'response_item') {
        continue;
      }

      const state = getTurnState(currentTurnId);
      if (!state) continue;

      if (record.payload?.type === 'message') {
        const text = extractMessageText(record.payload?.content);
        if (!text) continue;

        if (record.payload?.role === 'user') {
          state.input_preview = truncateText(text);
        } else if (record.payload?.role === 'assistant') {
          state.assistant_preview = truncateText(text);
          state.phase = record.payload?.phase || state.phase;
        }

        continue;
      }

      if (record.payload?.type === 'function_call') {
        state.tool_name = record.payload?.name || '';
      }
    }

    sessionFileCache.set(filePath, {
      mtimeMs: stat.mtimeMs,
      items,
    });

    return items;
  }

  return {
    async getLatestUsageSnapshot({ days = 7 } = {}) {
      try {
        await fs.access(sessionsRoot);
      } catch {
        return { found: false, reason: 'sessions_dir_not_found' };
      }

      const normalizedDays = clampNumber(days, 7, 1, 30);
      const entries = await listSessionEntries(normalizedDays);
      const signature = buildEntriesSignature(entries);
      const cacheKey = `latest:${normalizedDays}`;
      const cached = latestUsageCache.get(cacheKey);
      if (cached?.signature === signature) {
        return cached.value;
      }

      const latest = await findLatestTokenCountEvent(normalizedDays);
      if (!latest?.record) {
        const empty = { found: false, reason: 'no_rate_limit_data' };
        latestUsageCache.set(cacheKey, { signature, value: empty });
        return empty;
      }

      const rateLimits = latest.record.payload?.rate_limits || {};
      const primary = rateLimits.primary || null;
      const secondary = rateLimits.secondary || null;
      const recordedAt = latest.record.timestamp;
      const recordedAtMs = new Date(recordedAt).getTime();

      const value = {
        found: true,
        recorded_at: recordedAt,
        primary: primary ? {
          used_percent: primary.used_percent,
          window_minutes: primary.window_minutes,
          resets_at: primary.resets_in_seconds != null
            ? new Date(recordedAtMs + primary.resets_in_seconds * 1000).toISOString()
            : null,
        } : null,
        secondary: secondary ? {
          used_percent: secondary.used_percent,
          window_minutes: secondary.window_minutes,
          resets_at: secondary.resets_in_seconds != null
            ? new Date(recordedAtMs + secondary.resets_in_seconds * 1000).toISOString()
            : null,
        } : null,
        token_usage: latest.record.payload?.info?.total_token_usage ?? null,
      };

      latestUsageCache.set(cacheKey, { signature, value });
      return value;
    },

    async listModelCalls({ limit = 120, days = 7, cwd = '' } = {}) {
      const normalizedLimit = clampNumber(limit, 120, 1, 500);
      const normalizedDays = clampNumber(days, 7, 1, 30);
      const normalizedCwd = String(cwd || '').trim();
      const displayAccountName = await readCurrentAccountName();

      try {
        await fs.access(sessionsRoot);
      } catch {
        return {
          source: 'codex_sessions',
          generated_at: new Date().toISOString(),
          reason: 'sessions_dir_not_found',
          available_cwds: [],
          summary: buildEmptySummary(),
          items: [],
        };
      }

      const entries = await listSessionEntries(normalizedDays);
      const signature = buildEntriesSignature(entries);
      const cacheKey = `calls:${normalizedDays}:${normalizedLimit}:${normalizedCwd}:${displayAccountName || ''}`;
      const cached = modelCallsCache.get(cacheKey);
      if (cached?.signature === signature) {
        return cached.value;
      }

      const parsedItems = [];

      for (const { filePath } of entries) {
        const fileItems = await parseSessionFile(filePath);
        parsedItems.push(...fileItems.map((item) => ({
          ...item,
          display_account_name: displayAccountName,
        })));
      }

      parsedItems.sort((left, right) => {
        const leftTime = new Date(left.timestamp || 0).getTime();
        const rightTime = new Date(right.timestamp || 0).getTime();
        return rightTime - leftTime;
      });

      const availableCwds = [...new Set(
        parsedItems
          .map((item) => item.cwd)
          .filter(Boolean),
      )].sort((left, right) => left.localeCompare(right));

      const filteredItems = normalizedCwd
        ? parsedItems.filter((item) => item.cwd === normalizedCwd)
        : parsedItems;

      const items = filteredItems.slice(0, normalizedLimit);

      const value = {
        source: 'codex_sessions',
        generated_at: new Date().toISOString(),
        reason: items.length === 0 ? 'no_model_calls_found' : null,
        available_cwds: availableCwds,
        summary: summarizeCalls(items),
        items,
      };

      modelCallsCache.set(cacheKey, { signature, value });
      return value;
    },
  };
}
