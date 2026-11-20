/**
 * dsh-connect-deveco — client half.
 *
 * Two UI surfaces, both backed by the plugin's loopback-gated HTTP routes:
 *
 *   1. A compact status chip in conversation.composer.dock with only 启动 /
 *      停止 / 重启 proxy controls. When the account is logged out or expired,
 *      clicking the status capsule jumps to the DevEco settings section
 *      (account login / logout lives there, not in the dock).
 *   2. A settings section (Huawei account login panel + controls + risk notice),
 *      modeled after the account panels in dsh-our-free-model.
 *
 * Every visible string goes through the Client locale service (zh / en) with
 * an inline fallback. Colors come only from --dsw-* theme tokens, so both
 * surfaces follow light and dark themes.
 */
(function () {
  'use strict';

  var NS = 'dsh-connect-deveco';
  var BASE = '/plugins/dsh-connect-deveco';
  var POLL_MS = 10000;
  var POST_TIMEOUT_MS = 60000;

  var DICTS = {
    zh: {
      label: 'DevEco 代理',
      stateRunning: '运行中',
      stateStopped: '已停止',
      stateLoggedOut: '未登录',
      stateExpired: '授权已过期',
      stateUnknown: '状态未知',
      start: '启动',
      stop: '停止',
      restart: '重启',
      login: '登录',
      reLogin: '重新登录',
      logout: '登出',
      logoutTip: '清除本机保存的华为凭据并退出登录（代理保持运行）',
      starting: '启动中…',
      stopping: '停止中…',
      restarting: '重启中…',
      openingLogin: '正在打开登录页…',
      loggingOut: '正在登出…',
      startTip: '启动本地 DevEco 代理',
      stopTip: '停止本地 DevEco 代理（停止后不会自动重启）',
      restartTip: '停止并重新启动本地 DevEco 代理（解决大部分 503/连接拒绝错误）',
      loginTip: '在浏览器中打开华为账号登录页',
      startDone: '代理已启动',
      stopDone: '代理已停止',
      restartDone: '代理已重启',
      loginOpened: '已打开登录页，完成授权后会自动变为已登录',
      alreadyLoggedIn: '当前账号已登录',
      logoutDone: '已登出，本地凭据已清除',
      logoutFailed: '登出失败，请重试',
      startFailed: '代理启动失败',
      stopFailed: '代理停止失败',
      restartFailed: '代理重启后仍未运行',
      loginFailed: '打开登录页失败',
      actionFailed: '操作失败，请重试',
      minUnit: '分钟',
      settingsTitle: 'DevEco Code 代理',
      settingsDesc: '管理支撑 deveco GLM 提供方的本地 opencode-deveco 代理。',
      openSettingsHint: '点击前往设置页登录',
      openSettingsTip: '账号未登录或已过期，点击这里前往设置页完成华为账号登录',
      accountTitle: '华为账号',
      accountHint: '使用你自己的华为账号登录；插件不共享凭据、不绕过计费，每次调用都消耗你自己的额度。',
      accountRunning: '已登录',
      accountExpired: '授权已过期 — 请点击「重新登录」再次授权',
      expiryIn: '授权有效期至',
      accountLoggedOut: '未登录 — 点击下方按钮在浏览器中完成授权',
      accountStopped: '代理未运行 — 请先启动代理',
      controlsTitle: '代理控制',
      watchdog: '自动守护：代理意外退出时会在 60 秒内自动重启；手动停止后不再自动重启。',
      autoRestarts: '自动重启次数',
      riskTitle: '风险提示',
      riskText:
        '本项目通过非官方接口访问 DevEco 免费模型，上游一旦收紧限制可能失效。请自行评估账号风险；使用华为官方客户端始终是最安全的选择。',
    },
    en: {
      label: 'DevEco proxy',
      stateRunning: 'running',
      stateStopped: 'stopped',
      stateLoggedOut: 'logged out',
      stateExpired: 'authorization expired',
      stateUnknown: 'unknown',
      start: 'Start',
      stop: 'Stop',
      restart: 'Restart',
      login: 'Log in',
      reLogin: 'Re-login',
      logout: 'Log out',
      logoutTip: 'Clear the stored Huawei credentials and sign out (proxy stays running)',
      starting: 'starting…',
      stopping: 'stopping…',
      restarting: 'restarting…',
      openingLogin: 'opening login…',
      loggingOut: 'logging out…',
      startTip: 'Start the local DevEco proxy',
      stopTip: 'Stop the local DevEco proxy (it will not auto-restart)',
      restartTip: 'Stop and relaunch the local DevEco proxy (fixes most 503 / connect-refused errors)',
      loginTip: 'Open the Huawei account login page in the browser',
      startDone: 'Proxy started',
      stopDone: 'Proxy stopped',
      restartDone: 'Proxy restarted',
      loginOpened: 'Login page opened; the chip turns green once you authorize',
      alreadyLoggedIn: 'An account is already signed in',
      logoutDone: 'Signed out; stored credentials cleared',
      logoutFailed: 'Failed to sign out, please retry',
      startFailed: 'Proxy failed to start',
      stopFailed: 'Proxy failed to stop',
      restartFailed: 'Proxy is still not running after restart',
      loginFailed: 'Failed to open the login page',
      actionFailed: 'Action failed, please retry',
      minUnit: 'min',
      settingsTitle: 'DevEco Code proxy',
      settingsDesc: 'Manage the local opencode-deveco proxy behind the deveco GLM provider.',
      openSettingsHint: 'Click to sign in',
      openSettingsTip: 'The account is logged out or expired — click here to open Settings and sign in with your Huawei account',
      accountTitle: 'Huawei account',
      accountHint:
        'Sign in with your own Huawei account; the plugin shares no credentials and bypasses no billing — every call consumes your own quota.',
      accountRunning: 'Signed in',
      accountExpired: 'Authorization expired — click "Re-login" to authorize again',
      expiryIn: 'Valid until',
      accountLoggedOut: 'Not signed in — use the button below to authorize in your browser',
      accountStopped: 'Proxy is stopped — start it first',
      controlsTitle: 'Proxy controls',
      watchdog:
        'Watchdog: if the proxy dies on its own it is relaunched within 60 s; after an explicit Stop it stays off.',
      autoRestarts: 'Auto restarts',
      riskTitle: 'Risk notice',
      riskText:
        'This project reaches the DevEco free model through a non-official interface; upstream may tighten limits at any time. Assess your own account risk; the official Huawei client is always the safest choice.',
    },
  };

  window.__ModuleLoader__.load({
    id: 'dsh-connect-deveco',
    factory: function (require) {
      var React = require('react');
      var h = React.createElement;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useCallback = React.useCallback;
      var useRef = React.useRef;

      // Wired up in apply(): jumps to this plugin's DevEco settings section.
      // Defaults to a no-op until the slot service is available.
      var openSettingsSection = function () {};

      var fallback = (function () {
        try {
          var lang = (typeof navigator !== 'undefined' && navigator.language) || 'zh';
          return String(lang).toLowerCase().indexOf('zh') === 0 ? DICTS.zh : DICTS.en;
        } catch (e) {
          return DICTS.zh;
        }
      })();
      var translate = function (key) {
        return fallback[key] || String(key);
      };

      /** Shared status + action state used by both UI surfaces. */
      function useProxy() {
        var statusState = useState(null);
        var status = statusState[0];
        var setStatus = statusState[1];

        var busyState = useState(null); // null | start | stop | restart | login
        var busy = busyState[0];
        var setBusy = busyState[1];

        var noteState = useState('');
        var note = noteState[0];
        var setNote = noteState[1];
        var noteKindRef = useRef(null);

        var aliveRef = useRef(true);
        var fetchingRef = useRef(false);

        var refresh = useCallback(function () {
          if (fetchingRef.current) return Promise.resolve();
          fetchingRef.current = true;
          return fetch(BASE + '/status', {
            credentials: 'same-origin',
            signal: AbortSignal.timeout(8000),
          })
            .then(function (res) {
              if (!res.ok) throw new Error('HTTP ' + res.status);
              return res.json();
            })
            .then(function (data) {
              if (!aliveRef.current) return;
              setStatus(data);
              // Clear a stale "login page opened" note once login actually lands.
              if (data && data.logged_in && noteKindRef.current === 'loginOpened') {
                setNote('');
                noteKindRef.current = null;
              }
            })
            .catch(function () {
              // A failed probe is NOT proof the proxy is stopped — render unknown.
              if (aliveRef.current) setStatus({ running: false, unreachable: true });
            })
            .finally(function () {
              fetchingRef.current = false;
            });
        }, []);

        useEffect(function () {
          aliveRef.current = true;
          refresh();
          var timer = setInterval(refresh, POLL_MS);
          return function () {
            aliveRef.current = false;
            clearInterval(timer);
          };
        }, [refresh]);

        var act = useCallback(
          function (kind) {
            if (busy) return;
            setBusy(kind);
            setNote('');
            noteKindRef.current = null;
            var controller = new AbortController();
            var timer = setTimeout(function () {
              controller.abort();
            }, POST_TIMEOUT_MS);
            fetch(BASE + '/' + kind, {
              method: 'POST',
              credentials: 'same-origin',
              signal: controller.signal,
            })
              .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
              })
              .then(function (data) {
                if (!aliveRef.current) return;
                var ok = !!(data && data.ok);
                var key = null;
                if (kind === 'login') {
                  if (data && data.already_logged_in) {
                    key = 'alreadyLoggedIn';
                  } else {
                    key = ok ? 'loginOpened' : 'loginFailed';
                    if (ok) noteKindRef.current = 'loginOpened';
                  }
                } else if (kind === 'start') {
                  key = ok ? 'startDone' : 'startFailed';
                } else if (kind === 'stop') {
                  key = ok ? 'stopDone' : 'stopFailed';
                } else if (kind === 'restart') {
                  key = ok ? 'restartDone' : 'restartFailed';
                } else if (kind === 'logout') {
                  key = ok ? 'logoutDone' : 'logoutFailed';
                }
                if (key) setNote(translate(key));
                return refresh();
              })
              .catch(function () {
                if (aliveRef.current) setNote(translate('actionFailed'));
              })
              .finally(function () {
                clearTimeout(timer);
                if (aliveRef.current) setBusy(null);
              });
          },
          [busy, refresh],
        );

        return { status: status, busy: busy, note: note, act: act };
      }

      /** Derive dot color / state text / tooltip from a status object. */
      function statusView(status) {
        if (!status) {
          return {
            color: 'var(--dsw-alias-label-dimmed, #8e8e93)',
            text: translate('stateUnknown'),
          };
        }
        if (status.unreachable) {
          return {
            color: 'var(--dsw-alias-label-dimmed, #8e8e93)',
            text: translate('stateUnknown'),
          };
        }
        if (!status.running) {
          return {
            color: 'var(--dsw-alias-state-error-primary, #ff453a)',
            text: translate('stateStopped'),
          };
        }
        // Prefer the backend's truthful auth_state (valid|expired|logged_out|
        // unknown), falling back to the legacy logged_in boolean if absent.
        var auth = status.auth_state;
        if (!auth) auth = status.logged_in === false ? 'logged_out' : status.logged_in ? 'valid' : null;
        if (auth === 'expired') {
          return {
            color: 'var(--dsw-alias-state-error-primary, #ff453a)',
            text: translate('stateExpired'),
          };
        }
        if (auth === 'logged_out') {
          return {
            color: 'var(--dsw-alias-label-dimmed, #8e8e93)',
            text: translate('stateLoggedOut'),
          };
        }
        if (auth === 'valid') {
          return {
            color: 'var(--dsw-alias-state-success-primary, #34c759)',
            text: translate('stateRunning'),
          };
        }
        return {
          color: 'var(--dsw-alias-label-dimmed, #8e8e93)',
          text: translate('stateUnknown'),
        };
      }

      /** Format an epoch-ms expiry as a short local date string. */
      function formatExpiry(ms) {
        if (typeof ms !== 'number' || !(ms > 0)) return '';
        try {
          return new Date(ms).toLocaleString();
        } catch {
          return new Date(ms).toString();
        }
      }

      function tooltipFor(status) {
        var parts = ['127.0.0.1:17128'];
        if (status && status.running) {
          if (status.user) parts.push(String(status.user));
          if (status.auth_state === 'expired') {
            parts.push(translate('stateExpired'));
          } else if (status.auth_state === 'logged_out') {
            parts.push(translate('stateLoggedOut'));
          } else if (typeof status.expires_in_ms === 'number' && status.expires_in_ms > 0) {
            parts.push(Math.round(status.expires_in_ms / 60000) + ' ' + translate('minUnit'));
          }
        }
        return parts.join(' · ');
      }

      var pillStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        maxWidth: '100%',
        padding: '4px 12px',
        borderRadius: '999px',
        background:
          'var(--dsw-alias-fill-l1, var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.08)))',
        color: 'var(--dsw-alias-label-secondary, inherit)',
        border: '1px solid var(--dsw-alias-border-l2, transparent)',
        font: 'var(--dsw-font-xxs-12, 500 12px/1.4 var(--dsw-font-family, sans-serif))',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      };
      var dotBaseStyle = {
        flex: 'none',
        width: '8px',
        height: '8px',
        borderRadius: '999px',
      };
      var labelStyle = {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: 'var(--dsw-alias-label-primary, inherit)',
      };
      var mutedStyle = {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: 'var(--dsw-alias-label-tertiary, inherit)',
      };
      var buttonStyle = {
        flex: 'none',
        appearance: 'none',
        border: '1px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.35))',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, inherit)',
        font: 'inherit',
        lineHeight: '1.2',
        padding: '2px 10px',
        minHeight: '24px',
        borderRadius: '999px',
        cursor: 'pointer',
      };
      function chipButtonStyle(disabled) {
        return Object.assign({}, buttonStyle, {
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.55 : 1,
        });
      }

      /** Composer-dock chip: proxy controls only. Account login lives in Settings. */
      function DevEcoChip() {
        var proxy = useProxy();
        var status = proxy.status;
        var busy = proxy.busy;
        var note = proxy.note;
        var act = proxy.act;
        var view = statusView(status);

        var running = !!(status && status.running && !status.unreachable);
        var auth = status && status.auth_state ? status.auth_state : null;
        // When the proxy is up but the account needs attention, the status
        // capsule becomes a link that jumps to the DevEco Settings section.
        var needLogin =
          running &&
          (auth === 'logged_out' || auth === 'expired' || status.logged_in === false);
        var busyText =
          busy === 'start'
            ? translate('starting')
            : busy === 'stop'
              ? translate('stopping')
              : busy === 'restart'
                ? translate('restarting')
                : null;

        var buttons = [];
        if (!running) {
          buttons.push(
            h(
              'button',
              {
                key: 'start',
                type: 'button',
                className: 'dsh-devproxy-start',
                style: chipButtonStyle(!!busy),
                title: translate('startTip'),
                disabled: !!busy,
                onClick: function () {
                  act('start');
                },
              },
              translate('start'),
            ),
          );
        } else {
          buttons.push(
            h(
              'button',
              {
                key: 'stop',
                type: 'button',
                className: 'dsh-devproxy-stop',
                style: chipButtonStyle(!!busy),
                title: translate('stopTip'),
                disabled: !!busy,
                onClick: function () {
                  act('stop');
                },
              },
              translate('stop'),
            ),
            h(
              'button',
              {
                key: 'restart',
                type: 'button',
                className: 'dsh-devproxy-restart',
                style: chipButtonStyle(!!busy),
                title: translate('restartTip'),
                disabled: !!busy,
                onClick: function () {
                  act('restart');
                },
              },
              translate('restart'),
            ),
          );
        }

        var capsule = h(
          'span',
          {
            className: 'dsh-devproxy-capsule',
            style: Object.assign(
              {},
              { display: 'inline-flex', alignItems: 'center', gap: '8px' },
              needLogin
                ? { cursor: 'pointer', textDecoration: 'underline dotted' }
                : {},
            ),
            title: needLogin ? translate('openSettingsTip') : tooltipFor(status),
            onClick: needLogin
              ? function () {
                  openSettingsSection();
                }
              : undefined,
            role: needLogin ? 'button' : undefined,
            tabIndex: needLogin ? 0 : undefined,
            onKeyDown: needLogin
              ? function (e) {
                  if (e && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault && e.preventDefault();
                    openSettingsSection();
                  }
                }
              : undefined,
          },
          h('span', {
            className: 'dsh-devproxy-dot',
            style: Object.assign({}, dotBaseStyle, { background: view.color }),
          }),
          h(
            'span',
            { className: 'dsh-devproxy-label', style: labelStyle },
            translate('label') +
              ' · ' +
              view.text +
              (needLogin ? ' · ' + translate('openSettingsHint') : ''),
          ),
        );

        return h(
          'span',
          {
            className: 'dsh-devproxy-chip',
            style: pillStyle,
            title: needLogin ? translate('openSettingsTip') : tooltipFor(status),
          },
          capsule,
          busyText
            ? h(
                'span',
                {
                  key: 'busy',
                  className: 'dsh-devproxy-busy',
                  style: mutedStyle,
                  role: 'status',
                  'aria-live': 'polite',
                },
                busyText,
              )
            : h('span', { key: 'actions', style: { display: 'inline-flex', gap: '4px' } }, buttons),
          note
            ? h(
                'span',
                {
                  key: 'note',
                  className: 'dsh-devproxy-note',
                  style: {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color:
                      'var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary, inherit))',
                  },
                  role: 'status',
                  'aria-live': 'polite',
                },
                note,
              )
            : null,
        );
      }

      /** Settings-section card: Huawei login panel + controls + risk notice. */
      function DevEcoSettingsCard() {
        var proxy = useProxy();
        var status = proxy.status;
        var busy = proxy.busy;
        var note = proxy.note;
        var act = proxy.act;
        var view = statusView(status);

        var running = !!(status && status.running && !status.unreachable);
        var auth = status && status.auth_state ? status.auth_state : null;
        if (!auth && status && status.logged_in !== null && status.logged_in !== undefined) {
          auth = status.logged_in === false ? 'logged_out' : 'valid';
        }
        var cardStyle = {
          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2))',
          borderRadius: '12px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        };
        var h3Style = {
          margin: '0 0 4px',
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--dsw-alias-label-primary, inherit)',
        };
        var pStyle = {
          margin: 0,
          fontSize: '12px',
          lineHeight: '1.6',
          color: 'var(--dsw-alias-label-secondary, inherit)',
        };
        var panelStyle = {
          border: '1px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.3))',
          borderRadius: '10px',
          padding: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background:
            'var(--dsw-alias-fill-l1, var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.05)))',
        };
        var iconStyle = {
          flex: 'none',
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--dsw-alias-state-business-primary, #2b6cff)',
          background:
            'var(--dsw-alias-fill-l2, var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1)))',
        };
        var bigButtonStyle = Object.assign({}, buttonStyle, {
          padding: '6px 16px',
          minHeight: '28px',
        });
        var accountLine =
          !status || status.unreachable
            ? translate('stateUnknown')
            : !running
              ? translate('accountStopped')
              : auth === 'expired'
                ? translate('accountExpired')
                : auth === 'logged_out'
                  ? translate('accountLoggedOut')
                  : auth === 'valid'
                    ? (status.user ? String(status.user) + ' · ' : '') + translate('accountRunning')
                    : status.logged_in === false
                      ? translate('accountLoggedOut')
                      : (status.user ? String(status.user) + ' · ' : '') +
                        translate('accountRunning');

        return h(
          'div',
          { className: 'dsh-devproxy-settings', style: cardStyle },
          h(
            'div',
            null,
            h('h3', { style: h3Style }, translate('settingsTitle')),
            h('p', { style: pStyle }, translate('settingsDesc')),
          ),
          h(
            'div',
            null,
            h('h4', { style: h3Style }, translate('accountTitle')),
            h(
              'div',
              { style: panelStyle },
              h(
                'span',
                { style: iconStyle, 'aria-hidden': 'true' },
                h(
                  'svg',
                  { viewBox: '0 0 16 16', width: 18, height: 18 },
                  h('path', { d: 'M9 1 3 9h4l-1 6 6-8H8z', fill: 'currentColor' }),
                ),
              ),
              h(
                'span',
                { style: { flex: 1, minWidth: 0 } },
                h('div', { style: labelStyle }, accountLine),
                h(
                  'div',
                  {
                    style: Object.assign({}, mutedStyle, { whiteSpace: 'normal' }),
                  },
                  translate('accountHint'),
                ),
                auth === 'valid' && status && formatExpiry(status.auth_expiry_at)
                  ? h(
                      'div',
                      { style: Object.assign({}, mutedStyle, { whiteSpace: 'normal' }) },
                      translate('expiryIn') + ': ' + formatExpiry(status.auth_expiry_at),
                    )
                  : null,
              ),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 'none' } },
                h(
                  'button',
                  {
                    type: 'button',
                    style: bigButtonStyle,
                    disabled: !!busy,
                    onClick: function () {
                      act('login');
                    },
                  },
                  busy === 'login'
                    ? translate('openingLogin')
                    : auth === 'expired' || auth === 'valid'
                      ? translate('reLogin')
                      : translate('login'),
                ),
                (auth === 'valid' || auth === 'expired') && running
                  ? h(
                      'button',
                      {
                        type: 'button',
                        style: bigButtonStyle,
                        disabled: !!busy,
                        title: translate('logoutTip'),
                        onClick: function () {
                          act('logout');
                        },
                      },
                      busy === 'logout' ? translate('loggingOut') : translate('logout'),
                    )
                  : null,
              ),
            ),
          ),
          h(
            'div',
            null,
            h('h4', { style: h3Style }, translate('controlsTitle')),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              h('span', {
                style: Object.assign({}, dotBaseStyle, { background: view.color }),
                'aria-hidden': 'true',
              }),
              h('span', { style: labelStyle }, view.text),
              h(
                'button',
                {
                  type: 'button',
                  style: bigButtonStyle,
                  disabled: !!busy || running,
                  onClick: function () {
                    act('start');
                  },
                },
                busy === 'start' ? translate('starting') : translate('start'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: bigButtonStyle,
                  disabled: !!busy || !running,
                  onClick: function () {
                    act('stop');
                  },
                },
                busy === 'stop' ? translate('stopping') : translate('stop'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: bigButtonStyle,
                  disabled: !!busy,
                  onClick: function () {
                    act('restart');
                  },
                },
                busy === 'restart' ? translate('restarting') : translate('restart'),
              ),
            ),
            h('p', { style: pStyle }, translate('watchdog')),
            status && typeof status.auto_restarts === 'number'
              ? h(
                  'p',
                  { style: pStyle },
                  translate('autoRestarts') + ': ' + status.auto_restarts,
                )
              : null,
          ),
          note
            ? h(
                'p',
                {
                  style: Object.assign({}, pStyle, {
                    color: 'var(--dsw-alias-state-business-primary, #2b6cff)',
                  }),
                  role: 'status',
                  'aria-live': 'polite',
                },
                note,
              )
            : null,
          h(
            'div',
            null,
            h('h4', { style: h3Style }, translate('riskTitle')),
            h('p', { style: pStyle }, translate('riskText')),
          ),
        );
      }

      function PluginIcon(props) {
        var size = typeof props && typeof props.size === 'number' ? props.size : 16;
        return h(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: size,
              height: size,
              color: 'var(--dsw-alias-state-business-primary, #2b6cff)',
            },
          },
          h(
            'svg',
            { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': 'true' },
            h('path', { d: 'M9 1 3 9h4l-1 6 6-8H8z', fill: 'currentColor' }),
          ),
        );
      }

      return {
        inject: ['slots'],
        apply: function (ctx) {
          // Prefer the Client locale service when it is available.
          try {
            var locale = ctx.get('locale');
            if (locale) {
              if (typeof locale.register === 'function') {
                try {
                  var disposeDicts = locale.register(NS, DICTS);
                  if (typeof disposeDicts === 'function' && typeof ctx.effect === 'function') {
                    ctx.effect(function () {
                      return disposeDicts;
                    });
                  }
                } catch (e) {
                  /* keep fallback dictionary */
                }
              }
              if (typeof locale.bind === 'function') {
                var bound = locale.bind(NS);
                if (typeof bound === 'function') {
                  translate = function (key) {
                    try {
                      var value = bound(key);
                      if (value) return value;
                    } catch (e) {
                      /* fall through to fallback */
                    }
                    return fallback[key] || String(key);
                  };
                }
              }
            }
          } catch (e) {
            /* locale service unavailable; fallback translation stays */
          }

          if (typeof ctx.effect !== 'function' || !ctx.slots) return;

          // Wire the capsule-click action: open this plugin's DevEco settings
          // section. Primary route uses the sidebar.settings slot's store seat
          // (openSection sets activeId + open atomically); fallback clicks the
          // settings trigger then the nav row by its localized label.
          openSettingsSection = function () {
            var slotsSvc = null;
            try {
              slotsSvc = ctx.get('slots');
            } catch (e) {
              /* ignore */
            }
            if (slotsSvc && typeof slotsSvc.entries === 'function') {
              try {
                var seats = slotsSvc.entries('sidebar.settings');
                var seat = seats && seats[0] && seats[0].store;
                if (seat && typeof seat.create === 'function') {
                  var instance = seat.create();
                  var openSection = instance && instance.actions && instance.actions.openSection;
                  if (typeof openSection === 'function') {
                    openSection('dsh-connect-deveco');
                    return;
                  }
                  var open = instance && instance.actions && instance.actions.open;
                  if (typeof open === 'function') {
                    open();
                  }
                }
              } catch (e) {
                /* fall through to DOM route */
              }
            }
            // DOM fallback: open the settings panel, then click the nav row.
            try {
              var panel = document.querySelector('[data-shortcut-modal="settings"]');
              var trigger = document.querySelector(
                'button[aria-haspopup="dialog"][aria-expanded]',
              );
              if (trigger && !panel) trigger.click();
              var label = translate('settingsTitle');
              var tryClick = function () {
                var rows = document.querySelectorAll('button');
                for (var i = 0; i < rows.length; i += 1) {
                  if (rows[i].textContent && rows[i].textContent.trim() === label.trim()) {
                    rows[i].click();
                    return true;
                  }
                }
                return false;
              };
              if (!tryClick()) {
                setTimeout(tryClick, 80);
              }
            } catch (e) {
              /* no-op: nothing else we can do without the DOM */
            }
          };

          // Composer-dock chip.
          ctx.effect(function () {
            return ctx.slots.inject('conversation.composer.dock', function () {
              return ctx.slots.register(
                {
                  name: 'conversation.composer.dock',
                  id: 'dsh-connect-deveco',
                  order: 10,
                },
                function () {
                  return h(DevEcoChip);
                },
              );
            });
          });

          // Settings section (list slot keyed by the same id as its icon).
          ctx.effect(function () {
            var disposers = [];
            disposers.push(
              ctx.slots.inject('settings.section', function () {
                var dispose = ctx.slots.register(
                  {
                    name: 'settings.section',
                    id: 'dsh-connect-deveco',
                    order: 35,
                    label: function () {
                      return translate('settingsTitle');
                    },
                    locale: NS,
                  },
                  function () {
                    return h(DevEcoSettingsCard);
                  },
                );
                disposers.push(dispose);
                return dispose;
              }),
            );
            disposers.push(
              ctx.slots.inject('settings.section.icon', function () {
                var dispose = ctx.slots.register(
                  {
                    name: 'settings.section.icon',
                    id: 'dsh-connect-deveco',
                    locale: NS,
                  },
                  function (iconProps) {
                    return h(PluginIcon, { size: iconProps && iconProps.size });
                  },
                );
                disposers.push(dispose);
                return dispose;
              }),
            );
            return function () {
              for (var i = 0; i < disposers.length; i += 1) {
                try {
                  if (typeof disposers[i] === 'function') disposers[i]();
                } catch (e) {
                  /* ignore */
                }
              }
            };
          });
        },
      };
    },
  });
})();
