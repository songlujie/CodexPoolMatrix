export function createAuthRuntimeService({
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
  projectAccountsDir,
  codexHomeDir,
  codexAuthPath,
  stripAnsi,
  shouldUseShellForBinary,
  getCodexCommandEnv,
  isWindowsStoreBinary,
  pool,
  createLog,
}) {
  const OPENCLAW_AUTH_PATH = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
  const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

  let loginSession = {
    status: 'idle',
    message: '',
    output: '',
    newFile: null,
    error: null,
  };
  let loginProc = null;

  function formatCodexProbeSummary(failures) {
    return failures
      .map(({ command, reason }) => `${command}: ${reason}`)
      .join('\n');
  }

  function getCodexShellCommand() {
    return process.platform === 'win32' ? 'where codex' : 'which codex';
  }

  function getCodexPathExamples() {
    if (process.platform === 'win32') {
      return [
        process.env.APPDATA ? `${process.env.APPDATA}\\npm\\codex.cmd` : null,
        process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\npm\\codex.cmd` : null,
        process.env.ProgramFiles ? `${process.env.ProgramFiles}\\nodejs\\codex.cmd` : null,
      ].filter(Boolean);
    }

    return [
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      path.join(os.homedir(), '.local', 'bin', 'codex'),
      path.join(os.homedir(), '.volta', 'bin', 'codex'),
    ];
  }

  function buildCodexUnavailableDetails(failures, configuredPath = '') {
    const lines = [
      '自动探测失败，当前没有找到可执行的 Codex CLI。',
      `当前设置页里的 Codex 路径：${configuredPath || '未填写'}`,
      '',
      '建议这样处理：',
      `1. 在系统终端执行 \`${getCodexShellCommand()}\`，确认 Codex 的真实安装路径。`,
      '2. 打开应用「设置」页面，在「CLI 配置 / Codex 可执行文件路径」里填入完整路径。',
      '3. 保存后重新点击登录。',
      '4. 如果终端里也找不到 Codex，请先安装 Codex CLI，再回到应用登录。',
      '',
      '常见安装路径示例：',
      ...getCodexPathExamples().map((item) => `- ${item}`),
    ];

    if (failures.length > 0) {
      lines.push('', '本次探测记录：', formatCodexProbeSummary(failures));
    }

    return lines.join('\n');
  }

  function getCodexUnavailableMessage(failures) {
    if (
      process.platform === 'win32' &&
      failures.some(({ command, reason }) => isWindowsStoreBinary(command) || /access is denied|拒绝访问|eperm/i.test(reason))
    ) {
      return '当前只探测到 Windows Store 版 Codex，但它不能被桌面端后端直接调用。请在设置页填写可执行的 codex.cmd、codex.bat 或 codex.exe 完整路径。';
    }

    return '没有找到可执行的 Codex CLI。请先让应用探测到它，或者在设置页填写 Codex 的完整可执行路径。';
  }

  function buildCodexCommandEnv(command) {
    const env = { ...getCodexCommandEnv() };
    if (!path.isAbsolute(String(command || '').trim())) {
      return env;
    }

    const binDir = path.dirname(command);
    const separator = process.platform === 'win32' ? ';' : ':';
    const currentPath = env.PATH || env.Path || env.path || '';
    const nextPath = [binDir, currentPath].filter(Boolean).join(separator);

    env.PATH = nextPath;
    env.Path = nextPath;
    return env;
  }

  async function collectVersionManagerCandidates(pushCandidate) {
    const roots = process.platform === 'win32'
      ? [
          process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null,
          process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'npm') : null,
          process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs') : null,
          process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'nodejs') : null,
          process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'scoop', 'shims') : null,
          process.env.NVM_SYMLINK || null,
        ].filter(Boolean)
      : [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          path.join(os.homedir(), '.local', 'bin'),
          path.join(os.homedir(), '.volta', 'bin'),
          path.join(os.homedir(), '.yarn', 'bin'),
          path.join(os.homedir(), '.npm-global', 'bin'),
        ];

    const names = process.platform === 'win32'
      ? ['codex.cmd', 'codex.bat', 'codex.exe', 'codex']
      : ['codex'];

    for (const root of roots) {
      for (const name of names) {
        pushCandidate(path.join(root, name));
      }
    }

    if (process.platform === 'win32') {
      return;
    }

    for (const [rootDir, suffix] of [
      [path.join(os.homedir(), '.local', 'share', 'fnm', 'node-versions'), ['installation', 'bin', 'codex']],
      [path.join(os.homedir(), '.nvm', 'versions', 'node'), ['bin', 'codex']],
    ]) {
      try {
        const entries = await fs.readdir(rootDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          pushCandidate(path.join(rootDir, entry.name, ...suffix));
        }
      } catch {
        // Ignore missing version-manager directories.
      }
    }
  }

  async function probeCodexCandidate(command) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(command, ['--version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: shouldUseShellForBinary(command),
          windowsHide: true,
          env: buildCodexCommandEnv(command),
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

  function looksLikeAuthFile(authData = {}) {
    const identity = getAuthIdentity(authData);
    return Boolean(
      identity.accessToken ||
      authData?.tokens?.refresh_token ||
      authData?.refresh_token ||
      authData?.OPENAI_API_KEY,
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
    const dest = path.join(projectAccountsDir, fileName);

    await fs.mkdir(projectAccountsDir, { recursive: true });
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
    const authJson = changedJsonFiles.find((file) => file.fileName === 'auth.json');
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

  async function syncOpenClawAuth(authFileSrc) {
    try {
      await fs.access(OPENCLAW_AUTH_PATH);
    } catch {
      return { ok: false, reason: 'openclaw auth-profiles.json 不存在' };
    }

    try {
      const authData = JSON.parse(await fs.readFile(authFileSrc, 'utf8'));
      const accessToken = authData.tokens?.access_token;
      const refreshToken = authData.tokens?.refresh_token;
      if (!accessToken) return { ok: false, reason: 'no access_token in auth file' };

      const payload = decodeJwtPayload(accessToken);
      const accountId = payload?.['https://api.openai.com/auth']?.chatgpt_account_id ?? null;
      const expiresAt = payload?.exp ? payload.exp * 1000 : Date.now() + 864000000;

      const profiles = JSON.parse(await fs.readFile(OPENCLAW_AUTH_PATH, 'utf8'));

      if (!profiles.profiles) profiles.profiles = {};
      profiles.profiles['openai-codex:default'] = {
        type: 'oauth',
        provider: 'openai-codex',
        access: accessToken,
        refresh: refreshToken || '',
        expires: expiresAt,
        accountId: accountId || '',
      };

      if (profiles.usageStats?.['openai-codex:default']) {
        delete profiles.usageStats['openai-codex:default'].cooldownUntil;
        delete profiles.usageStats['openai-codex:default'].lastFailureAt;
        profiles.usageStats['openai-codex:default'].errorCount = 0;
        profiles.usageStats['openai-codex:default'].failureCounts = {};
      }
      if (profiles.usageStats?.['openai:default']) {
        delete profiles.usageStats['openai:default'].cooldownUntil;
        delete profiles.usageStats['openai:default'].lastFailureAt;
        profiles.usageStats['openai:default'].errorCount = 0;
        profiles.usageStats['openai:default'].failureCounts = {};
      }

      await fs.writeFile(OPENCLAW_AUTH_PATH, JSON.stringify(profiles, null, 2));
      return { ok: true, email: payload?.['https://api.openai.com/profile']?.email };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async function switchAuthFile(authFilePath) {
    if (!authFilePath) return { ok: false, reason: 'auth_file_path 为空' };

    const src = expandPath(authFilePath);
    const dest = path.join(codexHomeDir, 'auth.json');

    try {
      await fs.access(src);
      await fs.mkdir(codexHomeDir, { recursive: true });
      await fs.copyFile(src, dest);

      const openclawResult = await syncOpenClawAuth(src);
      return { ok: true, dest, openclaw: openclawResult };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async function refreshTokenForAuthFile(authFilePath) {
    const fullPath = expandPath(authFilePath);

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

    let clientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
    const existingPayload = decodeJwtPayload(authData.tokens?.access_token);
    if (existingPayload?.client_id) {
      clientId = existingPayload.client_id;
    }

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

      authData.tokens.access_token = data.access_token;
      if (data.refresh_token) authData.tokens.refresh_token = data.refresh_token;
      if (data.id_token) authData.tokens.id_token = data.id_token;
      authData.last_refresh = new Date().toISOString();

      await fs.writeFile(fullPath, JSON.stringify(authData, null, 2));

      const newPayload = decodeJwtPayload(data.access_token);
      const newExpiresAt = newPayload?.exp
        ? new Date(newPayload.exp * 1000).toISOString()
        : null;

      return { ok: true, newExpiresAt };
    } catch (err) {
      return { ok: false, reason: `网络请求失败: ${err.message}` };
    }
  }

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

  async function restartOpenClawProcess() {
    if (process.platform === 'win32') {
      return { ok: false, reason: 'Windows 暂不支持自动重启 OpenClaw 进程，请手动重启 OpenClaw。' };
    }

    try {
      const { stdout } = await execAsync("pgrep -f 'openclaw-gateway' || pgrep -f 'openclaw.*main' || pgrep -f 'openclaw serve' || pgrep -f 'openclaw$'");
      const pids = stdout.trim().split('\n').filter(Boolean);

      if (pids.length === 0) {
        return { ok: false, reason: 'openclaw_not_running' };
      }

      for (const pid of pids) {
        try {
          await execAsync(`kill -TERM ${pid.trim()}`);
        } catch {
          // Process may already be gone.
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

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

  async function reloadOpenClaw() {
    const gw = await getOpenClawGatewayConfig();

    try {
      const resp = await fetch(`http://127.0.0.1:${gw.port}/api/auth/reload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gw.token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        return { ok: true, method: 'gateway_api' };
      }
    } catch {
      // Fall through to process signals.
    }

    if (process.platform === 'win32') {
      return { ok: false, reason: 'Windows 暂不支持自动发送 OpenClaw 进程信号，请手动重启 OpenClaw。' };
    }

    try {
      const { stdout } = await execAsync("pgrep -f 'openclaw-gateway'");
      const pids = stdout.trim().split('\n').filter(Boolean);
      if (pids.length > 0) {
        for (const pid of pids) {
          await execAsync(`kill -HUP ${pid.trim()}`);
        }
        return { ok: true, method: 'sighup', pids };
      }
    } catch {
      // Fall through to restart path.
    }

    return restartOpenClawProcess();
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
          stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach(pushCandidate);
        } catch {
          // Ignore missing command.
        }
      }
    } else {
      try {
        const { stdout } = await execAsync('which codex || command -v codex');
        stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach(pushCandidate);
      } catch {
        // Ignore missing command.
      }

      for (const lookupCommand of [
        "zsh -lic 'command -v codex'",
        "bash -lic 'command -v codex'",
      ]) {
        try {
          const { stdout } = await execAsync(lookupCommand);
          stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach(pushCandidate);
        } catch {
          // Ignore shell-specific lookup failure.
        }
      }
    }

    await collectVersionManagerCandidates(pushCandidate);

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
      details: buildCodexUnavailableDetails(failures, fromSettings),
    };
  }

  async function startCodexLogin() {
    if (loginProc) {
      const error = new Error('已有登录进程正在运行，请等待或取消');
      error.status = 409;
      throw error;
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
      const error = new Error(resolvedCodex.message);
      error.status = 400;
      throw error;
    }

    const codexBin = resolvedCodex.command;
    const codexDir = codexHomeDir;
    let beforeFiles = new Set();
    try {
      const files = await fs.readdir(codexDir);
      for (const file of files) {
        const stat = await fs.stat(path.join(codexDir, file));
        beforeFiles.add(`${file}::${stat.mtimeMs}`);
      }
    } catch {
      // Dir may not exist yet.
    }

    loginSession = { status: 'running', message: '正在启动 codex login…', output: '', newFile: null, error: null };

    try {
      loginProc = spawn(codexBin, ['login'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: shouldUseShellForBinary(codexBin),
        windowsHide: true,
        env: buildCodexCommandEnv(codexBin),
      });
    } catch (error) {
      loginSession = {
        status: 'error',
        message: `无法启动 codex: ${error.message}`,
        output: loginSession.output,
        newFile: null,
        error: error.message,
      };
      error.status = 400;
      throw error;
    }

    const appendOutput = (chunk) => {
      const text = stripAnsi(chunk.toString());
      loginSession.output += text;
      const lines = loginSession.output.trim().split('\n').filter(Boolean);
      loginSession.message = lines[lines.length - 1] || '…';
    };

    loginProc.stdout.on('data', appendOutput);
    loginProc.stderr.on('data', appendOutput);

    loginProc.on('error', (err) => {
      loginProc = null;
      loginSession = {
        status: 'error',
        message: `无法启动 codex: ${err.message}`,
        output: loginSession.output,
        newFile: null,
        error: err.message,
      };
    });

    loginProc.on('exit', async (code) => {
      loginProc = null;
      if (code !== 0) {
        loginSession = {
          status: 'error',
          message: `登录失败 (exit ${code})`,
          output: loginSession.output,
          newFile: null,
          error: `exit ${code}`,
        };
        return;
      }

      try {
        await fs.mkdir(codexDir, { recursive: true });
        const latestAuthFile = await findLatestChangedAuthFile(codexDir, beforeFiles);

        if (latestAuthFile) {
          const saved = await saveAuthFileToAccounts(latestAuthFile.fullPath, latestAuthFile.fileName);
          loginSession = {
            status: 'success',
            message: `登录成功！已保存 ${saved.fileName}`,
            output: loginSession.output,
            newFile: saved.fileName,
            error: null,
          };
        } else {
          loginSession = {
            status: 'success',
            message: '登录成功，但未找到可保存的 auth 文件',
            output: loginSession.output,
            newFile: null,
            error: 'auth_file_not_found',
          };
        }
      } catch (error) {
        loginSession = {
          status: 'success',
          message: '登录成功，但保存 auth 文件失败',
          output: loginSession.output,
          newFile: null,
          error: error.message,
        };
      }
    });

    return { ok: true };
  }

  function getCodexLoginStatus() {
    return loginSession;
  }

  function cancelCodexLogin() {
    if (loginProc) {
      loginProc.kill('SIGTERM');
      loginProc = null;
    }
    loginSession = { status: 'idle', message: '', output: '', newFile: null, error: null };
    return { ok: true };
  }

  return {
    syncOpenClawAuth,
    switchAuthFile,
    refreshTokenForAuthFile,
    reloadOpenClaw,
    startCodexLogin,
    getCodexLoginStatus,
    cancelCodexLogin,
  };
}
