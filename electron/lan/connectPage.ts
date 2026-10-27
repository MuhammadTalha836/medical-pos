// The counter PC's own screen (LAN mode, M11), shown before the main computer's app loads: pairing, "connecting",
// "please update" and leaving counter mode. It is a self-contained page (no network files), loaded as a data URL;
// it talks to the main process only through window.electronAPI.

export type ConnectView = 'setup' | 'confirm' | 'connecting' | 'update' | 'leave';

export interface ConnectState {
  view: ConnectView;
  message?: string | null;
  error?: string | null;
  host?: string;
  port?: number;
  name?: string;
  code?: string;
  serverName?: string;
  fingerprintShort?: string;
  clientVersion?: string;
  serverVersion?: string;
  /** Opened from a working single-PC app: show Back and the note about this PC's own data */
  fromApp?: boolean;
  /** Already a paired counter (show "Leave counter mode") */
  paired?: boolean;
}

const css = `
:root { color-scheme: light dark; --bg:#f1f5f9; --card:#ffffff; --text:#0f172a; --muted:#475569; --line:#cbd5e1;
  --accent:#0d9488; --accent-text:#ffffff; --danger:#be123c; --warn-bg:#fef3c7; --warn-text:#92400e; --code-bg:#f8fafc; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1120; --card:#111827; --text:#f1f5f9; --muted:#94a3b8; --line:#334155;
  --accent:#14b8a6; --accent-text:#042f2e; --danger:#fb7185; --warn-bg:#422006; --warn-text:#fcd34d; --code-bg:#0f172a; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--text);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding:16px; }
main { width:100%; max-width:520px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:28px; }
h1 { font-size:22px; margin:0 0 4px; }
p { margin:6px 0; color:var(--muted); }
label { display:block; font-size:13px; font-weight:600; margin:14px 0 4px; }
input { width:100%; font:inherit; padding:9px 11px; border-radius:8px; border:1px solid var(--line); background:var(--code-bg); color:var(--text); }
input:focus { outline:2px solid var(--accent); outline-offset:1px; }
.row { display:grid; grid-template-columns: 1fr 120px; gap:12px; }
.actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:20px; }
button { font:inherit; font-weight:600; border-radius:8px; padding:9px 16px; cursor:pointer; border:1px solid var(--line); background:transparent; color:var(--text); }
button.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-text); }
button:disabled { opacity:.6; cursor:default; }
.error { color:var(--danger); font-weight:600; margin-top:12px; }
.note { background:var(--warn-bg); color:var(--warn-text); border-radius:8px; padding:10px 12px; margin-top:14px; font-size:13px; }
.code { font: 700 26px/1.2 ui-monospace, Consolas, monospace; letter-spacing:2px; background:var(--code-bg); border:1px solid var(--line);
  border-radius:10px; padding:12px; text-align:center; margin:12px 0; }
.spinner { width:28px; height:28px; border:3px solid var(--line); border-top-color:var(--accent); border-radius:50%; animation:spin 1s linear infinite; margin:4px 0 12px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation:none; } }
section[hidden] { display:none; }
`;

const script = `
const api = window.electronAPI;
const state = JSON.parse(document.getElementById('state').textContent);
const $ = id => document.getElementById(id);
function show(view) { for (const s of document.querySelectorAll('section')) s.hidden = s.dataset.view !== view; }
function busy(on) { for (const b of document.querySelectorAll('button')) b.disabled = on; }
function err(id, text) { const el = $(id); el.textContent = text || ''; el.hidden = !text; }
window.updateStatus = text => { $('status-detail').textContent = text; };

$('host').value = state.host || '';
$('port').value = state.port || 4545;
$('name').value = state.name || '';
$('setup-message').textContent = state.message || '';
$('setup-message').hidden = !state.message;
$('local-data-note').hidden = !state.fromApp;
$('cancel').hidden = !state.fromApp;
$('to-leave').hidden = !state.paired;
err('setup-error', state.error);

$('check').onclick = async () => {
  err('setup-error', '');
  const host = $('host').value.trim(), port = Number($('port').value), code = $('code').value.trim(), name = $('name').value.trim();
  if (!host) return err('setup-error', 'Enter the main computer address, e.g. 192.168.1.10.');
  if (!/^\\d{6}$/.test(code)) return err('setup-error', 'Enter the 6-digit code shown on the main computer.');
  if (!name) return err('setup-error', 'Give this counter a name, e.g. Counter 1.');
  busy(true);
  const res = await api.lanCheckServer(host, port);
  busy(false);
  if (!res.ok) return err('setup-error', res.error);
  Object.assign(state, { host, port, code, name });
  $('confirm-server').textContent = res.serverName;
  $('confirm-fingerprint').textContent = res.fingerprintShort;
  show('confirm');
};
$('pair').onclick = async () => {
  busy(true); err('confirm-error', '');
  const res = await api.lanPair({ host: state.host, port: state.port, code: state.code, name: state.name });
  busy(false);
  if (!res.ok) { err('confirm-error', res.error); return; }
  $('pair').textContent = 'Paired. Starting…';
  busy(true);
};
$('back').onclick = () => show('setup');
$('cancel').onclick = () => api.lanCancelSetup();
$('retry').onclick = () => api.lanRetry();
$('change').onclick = () => { $('to-leave').hidden = false; show('setup'); };
$('to-leave').onclick = () => show('leave');
$('to-leave-2').onclick = () => show('leave');
$('leave-back').onclick = () => show(state.view === 'leave' ? 'setup' : state.view);
$('leave').onclick = async () => {
  busy(true); err('leave-error', '');
  const res = await api.lanLeaveCounter($('dev-code').value.trim());
  busy(false);
  if (!res.ok) err('leave-error', res.error);
};
$('update-retry').onclick = () => api.lanRetry();

if (state.view === 'connecting') { $('status-server').textContent = state.serverName || (state.host + ':' + state.port); $('status-detail').textContent = state.message || 'Connecting…'; }
if (state.view === 'update') { $('update-versions').textContent = 'This computer: ' + state.clientVersion + '. Main computer: ' + state.serverVersion + '.'; }
show(state.view);
`;

const escapeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export function connectPageUrl(state: ConnectState): string {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>PharmaCare Pro – Counter set-up</title><style>${css}</style></head>
<body><main>
<section data-view="setup">
  <h1>Connect this counter</h1>
  <p>This computer sells from the main computer's data. On the main computer open <strong>Settings → Counters (LAN)</strong> and press <strong>Make pairing code</strong>.</p>
  <p id="setup-message" class="note" hidden></p>
  <div class="row">
    <div><label for="host">Main computer address</label><input id="host" placeholder="192.168.1.10" autocomplete="off"></div>
    <div><label for="port">Port</label><input id="port" type="number" min="1024" max="65535"></div>
  </div>
  <label for="code">Pairing code</label><input id="code" inputmode="numeric" maxlength="6" placeholder="6 digits" autocomplete="off">
  <label for="name">Name of this counter</label><input id="name" maxlength="40" placeholder="Counter 1">
  <p id="local-data-note" class="note" hidden>Any data saved on this computer stays here untouched, but it will not be used while this is a counter.</p>
  <p id="setup-error" class="error" hidden></p>
  <div class="actions">
    <button id="check" class="primary">Connect</button>
    <button id="cancel">Back</button>
    <button id="to-leave" hidden>Leave counter mode</button>
  </div>
</section>
<section data-view="confirm" hidden>
  <h1>Check the security code</h1>
  <p>Main computer: <strong id="confirm-server"></strong></p>
  <p>Its security code must be the same as the one on the main computer's Counters screen:</p>
  <div class="code" id="confirm-fingerprint"></div>
  <p id="confirm-error" class="error" hidden></p>
  <div class="actions"><button id="pair" class="primary">They match, pair now</button><button id="back">Back</button></div>
</section>
<section data-view="connecting" hidden>
  <div class="spinner" aria-hidden="true"></div>
  <h1>Connecting to the main computer</h1>
  <p><strong id="status-server"></strong></p>
  <p id="status-detail" role="status"></p>
  <p>Check that the main computer is on and the PharmaCare Pro app is open on it.</p>
  <div class="actions"><button id="retry" class="primary">Try now</button><button id="change">Change main computer</button><button id="to-leave-2">Leave counter mode</button></div>
</section>
<section data-view="update" hidden>
  <h1>Please update this computer</h1>
  <p>This counter and the main computer must run the same version of PharmaCare Pro.</p>
  <p id="update-versions"></p>
  <p>Install the same version as the main computer on this counter, then open it again.</p>
  <div class="actions"><button id="update-retry" class="primary">Try again</button></div>
</section>
<section data-view="leave" hidden>
  <h1>Leave counter mode</h1>
  <p>This computer will work on its own again, with its own data. Enter the Developer authenticator code.</p>
  <label for="dev-code">Authenticator code</label><input id="dev-code" inputmode="numeric" maxlength="6" autocomplete="off">
  <p id="leave-error" class="error" hidden></p>
  <div class="actions"><button id="leave" class="primary">Leave counter mode</button><button id="leave-back">Back</button></div>
</section>
</main>
<script id="state" type="application/json">${escapeJson(state)}</script>
<script>${script}</script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
