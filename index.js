/**
 * dsh-connect-deveco — host half.
 *
 * Manages the local opencode-deveco proxy (127.0.0.1:17128) that backs the
 * `deveco` LLM provider inside DSH:
 *
 *   Loopback-gated HTTP routes under /plugins/dsh-connect-deveco/*:
 *     GET  /status  → proxy status (running / logged_in / user / expiry,
 *                     plus auth_state valid|expired|logged_out|unknown and
 *                     auth_expiry_at from the local jwt exp claim)
 *     POST /start   → launch the proxy
 *     POST /stop    → stop the proxy (pauses the watchdog until next start)
 *     POST /restart → stop + relaunch, wait until it listens
 *     POST /login   → open the Huawei OAuth page in the default browser
 *     POST /logout  → clear stored credentials via the proxy's /v2/logout
 *
 *   One agent tool `deveco_proxy`
 *   (action: status|start|stop|restart|login|logout) calling the same services.
 *
 *   A 60 s watchdog that silently re-launches the proxy if it dies on its own.
 *   An explicit STOP pauses the watchdog so the proxy stays off until the user
 *   starts it again.
 *
 * The proxy root is configurable via the DEVECO_PROXY_ROOT environment variable
 * or the plugin's `proxyRoot` config; it otherwise falls back to the copy of
 * opencode-deveco vendored in ./vendor/opencode-deveco next to this file.
 *
 * The provider itself is NOT registered here — it lives in the profile's
 * llm-pi-ai config (config.providers.deveco) and already works end to end.
 * This plugin is only the management layer on top of it.
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Absolute location of this plugin's own files (the WMI fallback stop script
// lives beside index.js, not in the third-party proxy repo).
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PROXY_ROOT = path.join(PLUGIN_DIR, 'vendor', 'opencode-deveco');
var proxyRoot = process.env.DEVECO_PROXY_ROOT || DEFAULT_PROXY_ROOT;

const PROXY_PORT = 17128;
const STATUS_URL = `http://127.0.0.1:${PROXY_PORT}/v2/status`;
const LOGIN_URL = `http://127.0.0.1:${PROXY_PORT}/v2/login`;
const LOGOUT_URL = `http://127.0.0.1:${PROXY_PORT}/v2/logout`;
const WATCHDOG_MS = 60000;
const ROUTE_BASE = '/plugins/dsh-connect-deveco';

var autoRestarts = 0;
var watchdogPaused = false;
var manualOpInFlight = false;
var restartInFlight = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scriptPath(name) {
  return path.join(proxyRoot, 'scripts', name);
}

/**
 * Read the local opencode-deveco jwt file and decode ONLY its `exp` claim.
 * The raw token is never returned, logged, or forwarded. Failure to read or
 * decode is treated as "no verifiable expiry" — never as a reason to claim a
 * healthy login. Mirrors token-store.ts defaultTokenFilePath/legacy paths.
 *
 * @returns {{ expMs: number|null, found: boolean }}
 */
function readJwtExpiry() {
  var base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  var dir = process.env.OPENCODE_CONFIG_DIR || path.join(base, 'opencode');
  var candidates = [path.join(dir, 'opencode-deveco', 'jwt.json'), path.join(base, 'opencode-deveco', 'jwt.json')];
  var picked = null;
  var savedAt = -1;
  for (var file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      var parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      var stamp = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
      if (stamp >= savedAt && typeof parsed.jwt === 'string' && parsed.jwt.split('.').length === 3) {
        picked = parsed.jwt;
        savedAt = stamp;
      }
    } catch {
      /* skip unreadable / malformed files */
    }
  }
  if (!picked) return { expMs: null, found: false };
  try {
    var payload = JSON.parse(Buffer.from(picked.split('.')[1], 'base64url').toString('utf8'));
    return { expMs: typeof payload.exp === 'number' ? payload.exp * 1000 : null, found: true };
  } catch {
    return { expMs: null, found: true };
  }
}

/**
 * Derive the account auth state: valid | expired | logged_out | unknown.
 * The proxy's /status cannot distinguish an expired jwt from a valid one, so
 * the local jwt `exp` claim is the only truthful expiry signal.
 */
function authStateOf(proxyLoggedIn) {
  var jwt = readJwtExpiry();
  if (!jwt.found && !proxyLoggedIn) return 'logged_out';
  if (!jwt.found) return 'unknown';
  if (jwt.expMs && jwt.expMs <= Date.now()) return 'expired';
  if (proxyLoggedIn || jwt.expMs) return 'valid';
  return 'unknown';
}

function runPowerShellFile(scriptFile, args, timeoutMs, cwd) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, ...args],
      {
        timeout: timeoutMs,
        windowsHide: true,
        cwd,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error ? error.code ?? null : 0,
          stdout: String(stdout ?? '').trim(),
          stderr: String(stderr ?? '').trim(),
          error: error ? String(error.message || error) : null,
        });
      },
    );
  });
}

function runPowerShell(scriptName, timeoutMs) {
  return runPowerShellFile(scriptPath(scriptName), [], timeoutMs, proxyRoot);
}

/** Probe the proxy; never throws. Down proxy → { running: false }. */
async function fetchStatus(timeoutMs = 4000) {
  let base;
  try {
    const res = await fetch(STATUS_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      base = { running: true, logged_in: null, error: `HTTP ${res.status}` };
    } else {
      const data = await res.json();
      base = {
        running: true,
        logged_in: Boolean(data.logged_in),
        user: data.user ?? null,
        expires_in_ms: data.expires_in_ms ?? null,
      };
    }
  } catch (err) {
    base = { running: false, logged_in: null, error: String((err && err.message) || err) };
  }
  // Enrich with the truthful account state from the local jwt exp claim.
  var jwt = readJwtExpiry();
  base.auth_state = authStateOf(base.logged_in);
  base.auth_expiry_at = jwt.expMs; // epoch ms or null; never the token itself
  return { ...base, auto_restarts: autoRestarts, watchdog_paused: watchdogPaused };
}

/**
 * Stop the proxy. The repo's stop-windows.ps1 uses Stop-Process/taskkill, which
 * get "Access is denied" when the proxy runs elevated (High integrity) while
 * DSH's shell is Medium integrity. So always finish with the WMI fallback:
 * Win32_Process.Terminate() runs via the SYSTEM WMI service and crosses the
 * integrity boundary. It is a no-op if the port is already free.
 */
async function stopProxy() {
  const normal = await runPowerShell('stop-windows.ps1', 30000);
  let status = await fetchStatus(1500);
  if (status.running) {
    const wmi = await runPowerShellFile(
      path.join(PLUGIN_DIR, 'stop-proxy-wmi.ps1'),
      ['-Port', String(PROXY_PORT)],
      30000,
      PLUGIN_DIR,
    );
    for (let i = 0; i < 10; i += 1) {
      status = await fetchStatus(1500);
      if (!status.running) break;
      await sleep(400);
    }
    return {
      ok: !status.running,
      stdout: [normal.stdout, wmi.stdout].filter(Boolean).join('\n'),
      stderr: [normal.stderr, wmi.stderr].filter(Boolean).join('\n'),
      error: wmi.error || normal.error,
    };
  }
  return normal;
}

/** Launch the proxy via its own start script (supervised, hidden window). */
async function startProxy() {
  return runPowerShell('start-windows.ps1', 30000);
}

/** Wait until the status endpoint answers, up to waitMs. */
async function waitForRunning(waitMs = 30000) {
  const deadline = Date.now() + waitMs;
  let status = await fetchStatus(3000);
  while (!status.running && Date.now() < deadline) {
    await sleep(800);
    status = await fetchStatus(3000);
  }
  return status;
}

async function doStart() {
  watchdogPaused = false;
  manualOpInFlight = true;
  try {
    const start = await startProxy();
    const status = await waitForRunning();
    return {
      ok: status.running,
      ...status,
      start_output: start.stdout || start.stderr || null,
    };
  } finally {
    manualOpInFlight = false;
  }
}

async function doStop() {
  watchdogPaused = true; // explicit stop → watchdog must not fight the user
  manualOpInFlight = true;
  try {
    const stop = await stopProxy();
    const status = await fetchStatus();
    return {
      ok: !status.running,
      ...status,
      stop_output: stop.stdout || stop.stderr || null,
    };
  } finally {
    manualOpInFlight = false;
  }
}

async function doRestart() {
  watchdogPaused = false;
  manualOpInFlight = true;
  try {
    const stop = await stopProxy();
    const start = await startProxy();
    const status = await waitForRunning();
    return {
      ok: status.running,
      ...status,
      stop_output: stop.stdout || stop.stderr || null,
      start_output: start.stdout || start.stderr || null,
    };
  } finally {
    manualOpInFlight = false;
  }
}

/** Single-flight restart: concurrent callers share one in-flight run. */
function restartProxy() {
  if (!restartInFlight) {
    restartInFlight = doRestart().finally(() => {
      restartInFlight = null;
    });
  }
  return restartInFlight;
}

/** Single-flight start, so the watchdog never races a manual start. */
let startInFlight = null;
function startProxySafe() {
  if (!startInFlight) {
    startInFlight = doStart().finally(() => {
      startInFlight = null;
    });
  }
  return startInFlight;
}

/** Single-flight stop, so the watchdog never races a manual stop. */
let stopInFlight = null;
function stopProxySafe() {
  if (!stopInFlight) {
    stopInFlight = doStop().finally(() => {
      stopInFlight = null;
    });
  }
  return stopInFlight;
}

// Locate an actual browser executable. We deliberately avoid both
// `cmd /c start <url>` (cmd.exe treats `&` in the OAuth URL as a command
// separator, truncating appid/code and wrongly launching `code` = VS Code)
// and `explorer.exe <url>` (spawn reports success but the page often never
// opens). Launching the browser exe directly with the URL as one argument
// passes through every query parameter and reliably brings up the page.
function findBrowserExecutable() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (e) {
      /* ignore */
    }
  }
  return null;
}

function openDefaultBrowser(url) {
  return new Promise((resolve, reject) => {
    const browser = findBrowserExecutable();
    // Fallback to explorer.exe only if no known browser exe was found.
    const exe = browser || 'explorer.exe';
    const child = spawn(exe, [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    let settled = false;
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on('spawn', () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
  });
}

/**
 * Make sure the proxy is up, then open the Huawei OAuth page in the user's
 * default browser. When `force` is set (a UI login / re-login click) the
 * browser is opened even if a valid jwt is already present — that is how
 * "switch account / re-authorize" works. Without force, an already-signed-in
 * account short-circuits (used by the agent tool to avoid surprise popups).
 */
async function loginFlow(force) {
  let status = await fetchStatus();
  if (!status.running) {
    status = await startProxySafe();
  }
  if (!status.running) {
    return { ok: false, error: 'proxy failed to start', status };
  }
  if (status.logged_in && !force) {
    return { ok: true, already_logged_in: true, user: status.user };
  }

  let loginUrl = null;
  try {
    const res = await fetch(LOGIN_URL, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    loginUrl = res.headers.get('location');
  } catch (err) {
    return { ok: false, error: `login endpoint unreachable: ${String((err && err.message) || err)}` };
  }
  if (!loginUrl) {
    return { ok: false, error: 'no login redirect returned by proxy' };
  }

  try {
    await openDefaultBrowser(loginUrl);
  } catch (err) {
    return { ok: false, error: `failed to open browser: ${String((err && err.message) || err)}`, loginUrl };
  }
  return { ok: true, loginUrl };
}

/**
 * Sign out: clear the stored Huawei credentials via the proxy's /v2/logout
 * (which deletes the jwt file, drops the session and resets the model cache),
 * then report the resulting account state. The proxy keeps running, so the
 * account panel immediately flips to "logged out" and the login button shows.
 */
async function logoutFlow() {
  let status = await fetchStatus();
  if (!status.running) {
    return { ok: false, error: 'proxy is not running; start it first', status };
  }
  try {
    const res = await fetch(LOGOUT_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, error: `logout endpoint HTTP ${res.status}` };
    }
  } catch (err) {
    return { ok: false, error: `logout endpoint unreachable: ${String((err && err.message) || err)}` };
  }
  status = await fetchStatus();
  return { ok: status.auth_state === 'logged_out', status };
}

const ACTIONS = ['status', 'start', 'stop', 'restart', 'login', 'logout'];

async function perform(action) {
  switch (action) {
    case 'status':
      return fetchStatus();
    case 'start':
      return startProxySafe();
    case 'stop':
      return stopProxySafe();
    case 'restart':
      return restartProxy();
    case 'login':
      return loginFlow();
    case 'logout':
      return logoutFlow();
    default:
      throw new Error(`invalid action: ${action}`);
  }
}

/**
 * Agent tool — registered as a plain registry-ready definition (the exact
 * object shape @deepseek-ai/dsh-tools' defineTool produces), so the plugin
 * carries zero non-builtin imports on the host side.
 */
const devecoProxyTool = {
  name: 'deveco_proxy',
  description:
    'Manage the local DevEco Code proxy (opencode-deveco on 127.0.0.1:17128) that backs the deveco GLM provider. ' +
    'action=status: report whether the proxy is running and logged in. ' +
    'action=start: launch the proxy. action=stop: stop the proxy (keeps it off until restarted). ' +
    'action=restart: stop and relaunch — fixes most 503 / connect-refused errors. ' +
    'action=login: open the Huawei OAuth login page in the browser. ' +
    'action=logout: sign out, clearing the stored Huawei credentials (proxy stays running). ' +
    'status also reports auth_state (valid|expired|logged_out|unknown) and auth_expiry_at.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ACTIONS,
        description: 'Operation to perform on the DevEco proxy.',
      },
    },
    required: ['action'],
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  timeoutMs: 150000,
  async execute(args) {
    const action = args && args.action;
    if (!ACTIONS.includes(action)) {
      throw new Error(`invalid arguments: action must be one of ${ACTIONS.join('|')}`);
    }
    return JSON.stringify(await perform(action), null, 2);
  },
  presentCall: (args) => ({
    card: 'generic',
    title: `DevEco proxy · ${args.action}`,
    kind: args.action === 'status' ? 'read' : 'other',
    rawInput: args,
  }),
};

function isLoopbackHost(hostname) {
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/** DNS-rebinding guard: only same-machine, loopback-named requests pass. */
function loopbackGate(req) {
  const remote = req.socket?.remoteAddress ?? '';
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
    return false;
  }
  const hostHeader = String(req.headers?.host ?? '');
  const hostname = hostHeader.replace(/:\d+$/, '').toLowerCase();
  if (!isLoopbackHost(hostname)) return false;
  const origin = req.headers?.origin;
  if (origin) {
    try {
      const originHostname = new URL(String(origin)).hostname.toLowerCase();
      if (!isLoopbackHost(originHostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function apply(ctx, config) {
  // Optional configuration: env var is applied at module load; plugin config
  // (when present) wins. This keeps the default zero-config while allowing a
  // portable/open-source install to point at a different checkout.
  if (config && typeof config.proxyRoot === 'string' && config.proxyRoot.trim()) {
    proxyRoot = config.proxyRoot.trim();
  }

  // Watchdog: if the proxy dies on its own, bring it back within WATCHDOG_MS.
  // An explicit STOP (watchdogPaused=true) or an in-flight manual operation
  // suppresses the check, so the watchdog never fights the user.
  ctx.effect(() => {
    const timer = setInterval(() => {
      if (watchdogPaused || manualOpInFlight || restartInFlight || startInFlight || stopInFlight) {
        return;
      }
      fetchStatus(3000)
        .then((status) => {
          if (
            !status.running &&
            !watchdogPaused &&
            !manualOpInFlight &&
            !restartInFlight &&
            !startInFlight &&
            !stopInFlight
          ) {
            autoRestarts += 1;
            restartProxy().catch(() => {});
          }
        })
        .catch(() => {});
    }, WATCHDOG_MS);
    return () => clearInterval(timer);
  });

  // NOTE: cordis `ctx.inject(deps, callback)` exposes the requested services on
  // the context passed INTO the callback (webCtx / toolsCtx), never on the
  // outer `ctx`. Registering on the outer ctx leaves `ctx.webServer` /
  // `ctx.tools` undefined, throws inside the callback, and the error is
  // swallowed — the fiber still reports "active" but nothing registers.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const disposers = [];

      const route = (suffix, method, handler) =>
        webCtx.webServer.register({
          kind: 'exact',
          path: `${ROUTE_BASE}${suffix}`,
          method,
          handler: async (req, res) => {
            if (!loopbackGate(req)) return sendJson(res, 403, { error: 'loopback only' });
            try {
              sendJson(res, 200, await handler());
            } catch (err) {
              sendJson(res, 500, { error: String((err && err.message) || err) });
            }
          },
        });

      disposers.push(route('/status', 'GET', () => fetchStatus()));
      disposers.push(route('/start', 'POST', () => startProxySafe()));
      disposers.push(route('/stop', 'POST', () => stopProxySafe()));
      disposers.push(route('/restart', 'POST', () => restartProxy()));
      // The UI login button is an explicit re-authorize intent — always open
      // the browser, even when a valid jwt is already present. The agent tool
      // (perform('login')) intentionally stays non-forcing.
      disposers.push(route('/login', 'POST', () => loginFlow(true)));
      disposers.push(route('/logout', 'POST', () => logoutFlow()));

      return () => {
        for (const dispose of disposers) {
          try {
            dispose?.();
          } catch {
            /* ignore disposal errors */
          }
        }
      };
    });
  });

  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(() => {
      const registered = toolsCtx.tools.register(devecoProxyTool);
      return typeof registered === 'function' ? registered : () => {};
    });
  });
}
