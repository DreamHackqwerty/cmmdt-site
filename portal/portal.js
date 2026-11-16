// ALware Portal: Supabase does accounts and data; this page only draws it.
(function () {
'use strict';

const cfg = window.PORTAL_CONFIG || {};
// A password-reset link lands here with "type=recovery" in the address.
let recovering = /type=recovery/.test(location.hash);
const BASE = cfg.basePath || '/portal/';
const $ = id => document.getElementById(id);
const tz = -new Date().getTimezoneOffset();
const RARITY_COLORS = {
  Trash: '#8c8c8c', Common: '#8cbebe', Uncommon: '#a1ffa1', Unusual: '#c987d3', Rare: '#776ec1',
  Fragment: '#ff4100', Extinct: '#ffabab', Legendary: '#ffb355', Mythical: '#ff2d73', Limited: '#4b63ff',
  Relic: '#66ffb2', Seed: '#aaff00', Gemstone: '#aa23ff', Apex: '#ff0000', Exotic: '#00aaff',
  Secret: '#d2d2d2', 'Divine Secret': '#a480ff',
};

function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === id));
}
function message(title, body, action) {
  $('msg-title').textContent = title;
  $('msg-body').textContent = body;
  $('msg-action').hidden = !action;
  show('view-message');
}

if (!cfg.supabaseUrl || cfg.supabaseUrl.includes('YOUR-PROJECT')) {
  message('Almost there', 'Fill in your Supabase address and key in portal/config.js.', false);
  return;
}
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
// The dashboard shell saves the display name the user picks (kept in their account).
window.portalSb = sb;   // the dashboard shell's global chat uses the same signed-in client
window.portalSaveName = async (name) => {
  const {error} = await sb.auth.updateUser({data: {display_name: name}});
  if (error) throw error;
};

// ALware's Link account button opens /portal/?code=XXXX-XXXX.
const params = new URLSearchParams(location.search);
let linkCode = params.get('code');
if (linkCode) {
  $('auth-intro').textContent = 'Log in or create an account to link ALware on your Mac.';
}
function pageUrl(withCode) {
  return location.origin + BASE + (withCode && linkCode ? '?code=' + encodeURIComponent(linkCode) : '');
}

// ------------------------------------------------------------------ auth

let mode = 'login';
function setMode(next) {
  mode = next;
  document.querySelectorAll('#auth-tabs button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('auth-tabs').hidden = mode === 'forgot';
  $('password-wrap').hidden = mode === 'forgot';
  $('forgot-btn').textContent = mode === 'forgot' ? 'Back to log in' : 'Forgot password?';
  $('auth-submit').textContent = {login: 'Log in', signup: 'Create account', forgot: 'Email me a reset link'}[mode];
  $('password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('auth-error').textContent = '';
}
document.querySelectorAll('#auth-tabs button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('forgot-btn').onclick = () => setMode(mode === 'forgot' ? 'login' : 'forgot');

$('auth-form').onsubmit = async e => {
  e.preventDefault();
  const email = $('email').value.trim(), password = $('password').value;
  const err = $('auth-error');
  err.className = 'error';
  err.textContent = '';
  $('auth-submit').disabled = true;
  try {
    if (mode === 'forgot') {
      const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: pageUrl(false)});
      if (error) throw error;
      err.className = 'error ok';
      err.textContent = 'If that email has an account, a reset link is on its way.';
    } else if (mode === 'signup') {
      if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
      const {data, error} = await sb.auth.signUp({email, password, options: {emailRedirectTo: pageUrl(true)}});
      if (error) throw error;
      if (data.session) await signedIn(data.session);
      else message('Check your email', 'We sent a confirmation link to ' + email +
                   '. Open it on this device to finish' + (linkCode ? ' linking ALware.' : '.'), false);
    } else {
      const {data, error} = await sb.auth.signInWithPassword({email, password});
      if (error) throw error;
      await signedIn(data.session);
    }
  } catch (ex) {
    err.textContent = ex.message || 'Something went wrong.';
  } finally {
    $('auth-submit').disabled = false;
  }
};

$('reset-form').onsubmit = async e => {
  e.preventDefault();
  const password = $('new-password').value;
  if (password.length < 8) { $('reset-error').textContent = 'Use at least 8 characters.'; return; }
  const {error} = await sb.auth.updateUser({password});
  if (error) { $('reset-error').textContent = error.message; return; }
  recovering = false;
  const {data} = await sb.auth.getSession();
  signedIn(data.session);
};

$('logout').onclick = async () => {
  await sb.auth.signOut();
  location.href = BASE;
};

let started = false;
async function signedIn(session) {
  if (!session) { show('view-auth'); return; }
  if (linkCode) {
    const code = linkCode;
    linkCode = null;
    history.replaceState(null, '', BASE);
    const {data, error} = await sb.rpc('link_device', {p_code: code});
    if (error || !data.ok) {
      message('Could not link ALware', (error && error.message) || data.error, true);
    } else {
      message('✅ ALware is linked', 'You can close this tab and go back to ALware. Your catches will show up on the dashboard.', true);
    }
    return;
  }
  $('me').dataset.name = ((session.user.user_metadata || {}).display_name || '').trim();
  $('me').textContent = session.user.email;
  $('account').hidden = false;
  show('view-dashboard');
  if (!started) {
    started = true;
    sb.realtime.setAuth(session.access_token);
    startDashboard();
  }
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') { recovering = true; show('view-reset'); }
  if (event === 'TOKEN_REFRESHED' && session) sb.realtime.setAuth(session.access_token);
});

(async () => {
  const {data} = await sb.auth.getSession();
  if (recovering) { show('view-reset'); return; }
  if (data.session) signedIn(data.session);
  else show('view-auth');
})();

// ------------------------------------------------------------- dashboard

let devices = [];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}
function rarity(r) {
  return r ? `<span class="rar" style="--c:${RARITY_COLORS[r] || '#888'}">${esc(r)}</span>` : '<span class="muted">—</span>';
}
function seconds(ts) { return ts ? new Date(ts).getTime() / 1000 : 0; }
function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Date.now() / 1000 - seconds(ts));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}
function hms(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return [Math.floor(sec / 3600), Math.floor(sec % 3600 / 60), sec % 60].map(n => String(n).padStart(2, '0')).join(':');
}
async function rpc(name, args) {
  const {data, error} = await sb.rpc(name, args);
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const rodPick = {};   // device id -> rod picked in its menu, kept across refreshes
function rodSwitch(d, st) {
  if (!d.online || !st.remote || !Array.isArray(st.rods) || !st.rods.length) return '';
  const pick = rodPick[d.id] || st.rod_value;
  const options = st.rods.map(([value, name]) =>
    `<option value="${esc(value)}"${value === pick ? ' selected' : ''}>${esc(name)}</option>`).join('');
  const note = st.rod_swap ? `Switching to ${esc(st.rod_swap)} ${st.running ? 'after this reel' : 'when it starts'}`
    : st.rod_swap_ready === false ? 'Set Spot 1 and Spot 2 in ALware (Settings › Portal) first'
    : 'Switches after the next reel';
  return `<div class="rod-switch">
      <label class="muted small" for="rod-${d.id}">Rod</label>
      <select id="rod-${d.id}" data-rod-select="${d.id}">${options}</select>
      <button class="small" data-rod="${d.id}"${st.rod_swap_ready === false ? ' disabled' : ''}>Switch rod</button>
      <span class="muted small">${note}</span>
    </div>`;
}

async function loadDevices() {
  // Rebuilding the list would close a rod menu someone has open.
  if (document.activeElement && document.activeElement.matches('[data-rod-select]')) return;
  const {data, error} = await sb.from('devices').select('id, name, created_at, last_seen, status, live_enabled').order('created_at');
  if (error) throw error;
  devices = data.map(d => ({...d, online: Date.now() / 1000 - seconds(d.last_seen) < 25}));
  const box = $('devices');
  box.innerHTML = devices.length ? devices.map(d => {
    const st = d.status || {};
    const pill = d.online ? (st.running ? '<span class="pill run live">Fishing</span>' : '<span class="pill on live">Online</span>')
                          : '<span class="pill">Offline</span>';
    const liveNote = d.live_enabled === false ? ' · live view off' : '';
    const detail = d.online && st.running
      ? `${esc(st.rod || 'Unknown rod')} · ${Number(st.caught) || 0} fish · ${hms(st.elapsed)}`
      : `Last seen ${ago(d.last_seen)}`;
    const line = detail + liveNote;
    const control = d.online && st.remote
      ? (st.running ? `<button class="small danger" data-command="stop" data-id="${d.id}">Stop</button>`
                    : `<button class="small start" data-command="start" data-id="${d.id}">Start</button>`)
      : '';
    return `<div class="device">
      <div class="grow"><div class="name">${esc(d.name)}</div><div class="muted small">${line}</div></div>
      ${pill}
      ${control}
      <button class="small" data-rename="${d.id}">Rename</button>
      <button class="small danger" data-unlink="${d.id}">Unlink</button>
      ${rodSwitch(d, st)}
    </div>`;
  }).join('') : '<div class="empty">No devices linked yet.</div>';
  for (const sel of [$('live-device'), $('report-device')]) {
    const keep = sel.value;
    const head = sel.id === 'report-device' ? '<option value="">All devices</option>' : '';
    sel.innerHTML = head + devices.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  }
  liveDeviceChanged();
  drawNow();
}
function liveDevice() {
  return devices.find(d => String(d.id) === liveId);
}
function liveOn() {
  const dev = liveDevice();
  return !!dev && dev.live_enabled !== false;
}

$('devices').onchange = e => {
  if (e.target.dataset.rodSelect) rodPick[e.target.dataset.rodSelect] = e.target.value;
};
$('devices').onclick = async e => {
  const rename = e.target.dataset.rename, unlink = e.target.dataset.unlink, command = e.target.dataset.command;
  const rod = e.target.dataset.rod;
  try {
    if (rod) {
      const value = $('rod-' + rod).value;
      e.target.disabled = true;
      e.target.textContent = 'Sending…';
      await rpc('send_command', {p_id: Number(rod), p_command: 'rod:' + value});
      delete rodPick[rod];
      for (const ms of [3000, 6000, 9000, 12000]) setTimeout(() => loadDevices().catch(() => {}), ms);
      return;
    }
    if (command) {
      e.target.disabled = true;
      e.target.textContent = command === 'start' ? 'Starting…' : 'Stopping…';
      await rpc('send_command', {p_id: Number(e.target.dataset.id), p_command: command});
      // ALware picks it up at its next heartbeat; check back often for a bit.
      for (const ms of [3000, 6000, 9000, 12000]) setTimeout(() => loadDevices().catch(() => {}), ms);
      return;
    } else if (rename) {
      const name = prompt('New name for this device:');
      if (name) await rpc('rename_device', {p_id: Number(rename), p_name: name});
    } else if (unlink) {
      if (!confirm('Unlink this device? ALware stops reporting until you link it again. Your catch history stays.')) return;
      await rpc('unlink_device', {p_id: Number(unlink)});
    } else return;
    await loadDevices();
  } catch (err) { alert(err.message); }
};

// ---------------------------------------------------------------- live view
// While this is open the page marks the device as watched every few seconds;
// ALware streams only then. Best case it is 720p video sent peer-to-peer
// (WebRTC), with Supabase only passing the offer and answer; until that
// connects, or if it cannot, ALware sends a JPEG every half second as
// Realtime broadcasts on a private channel only the device's owner can join.

let liveChannel = null, liveId = null, lastFrame = 0;

// Join or leave the device's channel to match the Live switch.
function liveDeviceChanged() {
  const id = $('live-device').value || null;
  const want = id && liveOnFor(id) ? id : null;
  $('live-on').checked = !!id && liveOnFor(id);
  $('live-on').disabled = !id;
  if (id !== liveId || !want) endCall(false);
  if (id !== liveId) {
    liveId = id;
    callRetryAt = 0;
    lastFrame = 0;
    $('live-img').hidden = true;
  }
  const joined = liveChannel ? liveChannel.topic.replace(/^realtime:/, '').slice(5) : null;
  if (joined === want) return drawLiveState();
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  if (!want) { lastFrame = 0; $('live-img').hidden = true; return drawLiveState(); }
  liveChannel = sb.channel('live-' + want, {config: {private: true}})
    .on('broadcast', {event: 'frame'}, ({payload}) => {
      if (!payload || typeof payload.jpeg !== 'string' || !liveOn() || videoLive()) return;
      $('live-img').src = 'data:image/jpeg;base64,' + payload.jpeg;
      $('live-img').hidden = false;
      lastFrame = Date.now();
      drawLiveState();
    })
    .on('broadcast', {event: 'answer'}, ({payload}) => {
      if (payload) gotAnswer(payload.call, payload.answer).catch(() => endCall(true));
    })
    .subscribe();
  watch();
  drawLiveState();
}
function liveOnFor(id) {
  const dev = devices.find(d => String(d.id) === String(id));
  return !!dev && dev.live_enabled !== false;
}
async function watch() {
  if (document.hidden) return endCall(false);
  if (liveId && liveOn()) {
    try { await sb.rpc('watch_device', {p_id: Number(liveId)}); } catch (e) { /* retried in a moment */ }
    startCall();
  }
}

// ---- smooth live view (WebRTC)
const ICE_SERVERS = [{urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']}];
let call = null, callRetryAt = 0, lastVideoTime = -1;
const VIDEO_STALL_MS = 6000;

function videoLive() { return !!call && call.playing; }

async function startCall() {
  const dev = liveDevice();
  if (call || !dev || !dev.online || !liveOn() || !(dev.status && dev.status.rtc)
      || !window.RTCPeerConnection || Date.now() < callRetryAt) return;
  const c = call = {deviceId: liveId, pc: new RTCPeerConnection({iceServers: ICE_SERVERS}), playing: false};
  const pc = c.pc;
  pc.addTransceiver('video', {direction: 'recvonly'});
  pc.ontrack = e => {
    if (call !== c) return;
    const video = $('live-video');
    video.srcObject = e.streams[0] || new MediaStream([e.track]);
    video.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (call === c && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) endCall(true);
  };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc, 3000);
    if (call !== c) return;
    c.callId = (await rpc('live_call', {p_id: Number(c.deviceId), p_offer: pc.localDescription.sdp})).call;
    // The answer normally arrives on the live channel; check the table too.
    for (let i = 0; i < 20 && call === c && !c.answered; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (call !== c || c.answered) break;
      const {data} = await sb.from('live_calls').select('answer').eq('id', c.callId).maybeSingle();
      if (data && data.answer) await gotAnswer(c.callId, data.answer);
    }
    if (call === c && !c.answered) endCall(true);   // ALware did not answer: keep the basic view
    // Connected but no picture after a while (a strict network): give up too.
    setTimeout(() => { if (call === c && !c.playing) endCall(true); }, 15000);
  } catch (err) {
    if (call === c) endCall(true);
  }
}
function iceGathered(pc, ms) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { if (pc.iceGatheringState === 'complete') resolve(); };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, ms);
  });
}
async function gotAnswer(callId, sdp) {
  const c = call;
  if (!c || !callId || c.callId !== callId || c.answered || typeof sdp !== 'string') return;
  c.answered = true;
  await c.pc.setRemoteDescription({type: 'answer', sdp});
}
function endCall(failed) {
  if (failed) callRetryAt = Date.now() + 30000;
  if (!call) return;
  const c = call;
  call = null;
  try { c.pc.close(); } catch (e) { /* already closed */ }
  const video = $('live-video');
  video.srcObject = null;
  video.hidden = true;
  lastVideoTime = -1;
  drawLiveState();
}
$('live-video').addEventListener('playing', () => {
  if (!call) return;
  call.playing = true;
  lastFrame = Date.now();
  drawLiveState();
});
function drawLiveState() {
  const dev = liveDevice();
  const age = lastFrame ? (Date.now() - lastFrame) / 1000 : Infinity;
  const ph = $('live-placeholder'), badge = $('live-badge');
  $('live-status').textContent = '';
  const video = $('live-video');
  if (videoLive()) {
    if (video.currentTime !== lastVideoTime) { lastVideoTime = video.currentTime; lastFrame = Date.now(); }
    // The video stopped moving (frozen on one frame): hang up, so the
    // half-second picture takes over at once and a fresh call is tried
    // shortly, instead of showing that frame forever.
    if (Date.now() - lastFrame > VIDEO_STALL_MS) return endCall(true);
    video.hidden = false;
    $('live-img').hidden = true;
  }
  if (!lastFrame || !liveOn()) {
    $('live-img').hidden = true;
    video.hidden = true;
    ph.hidden = false;
    ph.textContent = !dev ? 'Link ALware to see its screen here.'
      : !liveOn() ? 'Live view is off. ALware is not capturing your screen. Turn on Live to watch.'
      : dev.online ? 'Starting stream… the first frame arrives in a few seconds.'
      : 'This device is offline. Open ALware on it to watch.';
    badge.hidden = true;
    return;
  }
  ph.hidden = true;
  badge.hidden = false;
  const stale = age > 5;
  badge.textContent = stale ? 'PAUSED' : videoLive() ? 'LIVE · 720p' : 'LIVE';
  badge.classList.toggle('stale', stale);
  if (stale) $('live-status').textContent = `Last frame ${Math.round(age)} s ago.`;
}
$('live-on').onchange = async () => {
  const dev = liveDevice();
  if (!dev) return;
  const on = $('live-on').checked;
  dev.live_enabled = on;   // show it at once; the next refresh confirms it
  liveDeviceChanged();
  try { await rpc('set_live_view', {p_id: dev.id, p_on: on}); }
  catch (err) { alert(err.message); loadDevices().catch(() => {}); }
};
$('live-device').onchange = liveDeviceChanged;

// Fullscreen: the whole live box (picture and LIVE badge). iPhone Safari can
// only make a <video> fullscreen, so it gets the video's own player there.
function toggleFullscreen() {
  const box = $('live-box'), video = $('live-video');
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else if (box.requestFullscreen) {
    box.requestFullscreen().catch(() => {});
  } else if (box.webkitRequestFullscreen) {
    box.webkitRequestFullscreen();
  } else if (!video.hidden && video.webkitEnterFullscreen) {
    video.webkitEnterFullscreen();
  }
}
$('live-full').onclick = toggleFullscreen;
$('live-box').ondblclick = toggleFullscreen;
document.addEventListener('visibilitychange', watch);

// ---------------------------------------------------------------- reports

function hourLabel(t, withDay) {
  const d = new Date(t * 1000);
  const h = d.toLocaleTimeString([], {hour: 'numeric'});
  return withDay ? d.toLocaleDateString([], {weekday: 'short'}) + ' ' + h : h;
}

// ---- charts (hand-made SVG; the colors are the --s-* tokens in portal.css)

function niceTop(max) {
  max = Math.max(4, max);
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const step = mag * (max / mag > 5 ? 2 : 1);
  return {top: Math.ceil(max / step) * step, step};
}
function frame(svg, hours, max) {
  const W = svg.clientWidth || 600, H = 220, pad = {l: 34, r: 10, t: 12, b: 24};
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const {top, step} = niceTop(max);
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const y = v => pad.t + ih - v / top * ih;
  let out = '';
  for (let v = 0; v <= top; v += step) {
    out += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    out += `<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const bw = iw / Math.max(1, hours.length);
  const every = Math.ceil(hours.length / Math.max(1, Math.floor(iw / 52)));
  const multiDay = hours.length > 24;
  hours.forEach((h, i) => {
    if (i % every === 0) out += `<text x="${pad.l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(hourLabel(h.start, multiDay && i % (every * 2) === 0))}</text>`;
  });
  return {W, H, pad, iw, ih, y, bw, out};
}
function tipAt(e, html) {
  const tip = $('tip');
  if (!html) { tip.style.display = 'none'; return; }
  tip.innerHTML = html;
  if (tip.style.display !== 'block') { tip.classList.remove('show'); void tip.offsetWidth; tip.classList.add('show'); }
  tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX + 12, innerWidth - 250) + 'px';
  tip.style.top = (e.clientY + 12) + 'px';
}
function hourTip(h) {
  const rate = h.casts ? Math.round((h.casts - h.lost) / h.casts * 100) + '% landed' : 'no casts';
  const rar = Object.entries(h.rarities).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)}: ${v}`).join('<br>');
  return `<b>${esc(hourLabel(h.start, true))}</b><br>${h.fish} fish · ${h.lost} lost · ${rate}${rar ? '<br>' + rar : ''}`;
}

// Fish per hour: a line, with the average while fishing as a dashed rule.
function drawFishChart(hours, avg, anim) {
  const svg = $('chart-fish');
  animate(svg, anim);
  if (!hours.length) { svg.innerHTML = ''; return; }
  const f = frame(svg, hours, Math.max(avg || 0, ...hours.map(h => h.fish)));
  const pts = hours.map((h, i) => [f.pad.l + i * f.bw + f.bw / 2, f.y(h.fish)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  let out = f.out;
  out += `<path class="area" d="${line} L ${pts[pts.length - 1][0]} ${f.y(0)} L ${pts[0][0]} ${f.y(0)} Z"/>`;
  out += `<path class="line" pathLength="1" d="${line}"/>`;
  if (avg) {
    out += `<line class="avg" x1="${f.pad.l}" x2="${f.W - f.pad.r}" y1="${f.y(avg)}" y2="${f.y(avg)}"/>`;
    out += `<text class="avg-label" x="${f.W - f.pad.r}" y="${f.y(avg) - 6}" text-anchor="end">avg ${avg}/h</text>`;
  }
  out += `<line class="cross" id="fish-cross" y1="${f.pad.t}" y2="${f.y(0)}" visibility="hidden"/>`;
  out += `<circle class="dot" id="fish-dot" r="4.5" visibility="hidden"/>`;
  out += `<rect class="hit" x="${f.pad.l}" y="${f.pad.t}" width="${f.iw}" height="${f.ih}"/>`;
  svg.innerHTML = out;
  svg.onmousemove = e => {
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) * f.W / r.width;
    const i = Math.max(0, Math.min(hours.length - 1, Math.floor((x - f.pad.l) / f.bw)));
    const [px, py] = pts[i];
    const cross = $('fish-cross'), dot = $('fish-dot');
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
    tipAt(e, hourTip(hours[i]));
  };
  svg.onmouseleave = () => {
    tipAt(null);
    $('fish-cross').setAttribute('visibility', 'hidden');
    $('fish-dot').setAttribute('visibility', 'hidden');
  };
}

// Caught vs lost: two bars per hour, side by side.
function drawCaughtLost(hours, anim) {
  const svg = $('chart-cl');
  animate(svg, anim);
  if (!hours.length) { svg.innerHTML = ''; return; }
  const f = frame(svg, hours, Math.max(...hours.map(h => Math.max(h.fish, h.lost))));
  let out = f.out;
  const group = f.bw * .76, gap = Math.min(2, group * .08), w = Math.max(1, (group - gap) / 2);
  const bar = (cls, x, v, i) => {
    if (!v) return '';
    const top = f.y(v), h = f.y(0) - top, r = Math.min(4, w / 2, h);
    // rounded at the data end, square on the baseline
    return `<path class="${cls}" data-i="${i}" style="--d:${i}" d="M${x} ${f.y(0)} V${top + r} Q${x} ${top} ${x + r} ${top} H${x + w - r} Q${x + w} ${top} ${x + w} ${top + r} V${f.y(0)} Z"/>`;
  };
  hours.forEach((h, i) => {
    const x0 = f.pad.l + i * f.bw + (f.bw - group) / 2;
    out += bar('caught', x0, h.fish, i) + bar('lost', x0 + w + gap, h.lost, i);
    out += `<rect class="hit" data-i="${i}" x="${f.pad.l + i * f.bw}" y="${f.pad.t}" width="${f.bw}" height="${f.ih}"/>`;
  });
  svg.innerHTML = out;
  svg.onmousemove = e => {
    const i = e.target.dataset && e.target.dataset.i;
    tipAt(e, i === undefined ? null : hourTip(hours[i]));
  };
  svg.onmouseleave = () => tipAt(null);
}

// Where the time goes: a donut of the busiest activities, the rest as "Other".
const SLICE_COLORS = ['--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6', '--s-7'];
let sliceColor = {};   // a phase keeps its color while the page is open
function colorFor(phase) {
  if (phase === 'Other') return 'var(--s-other)';
  if (!sliceColor[phase]) {
    const used = new Set(Object.values(sliceColor));
    const free = SLICE_COLORS.find(c => !used.has(c));
    if (!free) return 'var(--s-other)';
    sliceColor[phase] = free;
  }
  return `var(${sliceColor[phase]})`;
}
function duration(sec) {
  sec = Math.round(sec);
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + String(sec % 60).padStart(2, '0') + 's';
  return Math.floor(sec / 3600) + 'h ' + String(Math.floor(sec % 3600 / 60)).padStart(2, '0') + 'm';
}
function drawPie(time, anim) {
  const svg = $('pie'), legend = $('pie-legend');
  animate(svg, anim);
  animate(legend, anim);
  const total = time.reduce((a, t) => a + Number(t.seconds), 0);
  $('time-total').textContent = total ? duration(total) + ' running' : '';
  if (!total) {
    svg.innerHTML = '<circle cx="100" cy="100" r="80" fill="none" stroke="var(--line)" stroke-width="28"/>';
    legend.innerHTML = '<li class="muted" style="display:block">No macro time recorded in this period yet.</li>';
    return;
  }
  let slices = time.map(t => ({phase: t.phase, seconds: Number(t.seconds)})).sort((a, b) => b.seconds - a.seconds);
  if (slices.length > 7) {
    const rest = slices.slice(6).reduce((a, t) => a + t.seconds, 0);
    slices = slices.slice(0, 6).concat([{phase: 'Other', seconds: rest, folded: true}]);
  }
  let a0 = -Math.PI / 2, out = '';
  const R = 92, r = 58, pt = (rad, a) => [100 + rad * Math.cos(a), 100 + rad * Math.sin(a)];
  slices.forEach((sl, i) => {
    const frac = sl.seconds / total, a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = frac >= .9999
      ? `M100 ${100 - R} A${R} ${R} 0 1 1 99.99 ${100 - R} L99.99 ${100 - r} A${r} ${r} 0 1 0 100 ${100 - r} Z`
      : `M${pt(R, a0)} A${R} ${R} 0 ${large} 1 ${pt(R, a1)} L${pt(r, a1)} A${r} ${r} 0 ${large} 0 ${pt(r, a0)} Z`;
    out += `<path d="${d}" fill="${colorFor(sl.phase)}" data-i="${i}" style="--d:${i}"/>`;
    a0 = a1;
  });
  out += `<text class="total" x="100" y="100" text-anchor="middle">${esc(duration(total))}</text>`;
  out += `<text class="total-k" x="100" y="118" text-anchor="middle">TOTAL</text>`;
  svg.innerHTML = out;
  const pct = s => (s / total * 100 >= 10 ? Math.round(s / total * 100) : (s / total * 100).toFixed(1)) + '%';
  legend.innerHTML = slices.map((sl, i) => `<li style="--d:${i}"><i style="background:${colorFor(sl.phase)}"></i>
    <span>${esc(sl.phase)}</span><span class="t">${duration(sl.seconds)}</span><span class="p">${pct(sl.seconds)}</span></li>`).join('');
  svg.onmousemove = e => {
    const i = e.target.dataset && e.target.dataset.i;
    if (i === undefined) return tipAt(null);
    const sl = slices[i];
    tipAt(e, `<b>${esc(sl.phase)}</b><br>${duration(sl.seconds)} · ${pct(sl.seconds)} of the time`);
  };
  svg.onmouseleave = () => tipAt(null);
}

function drawActivity(act, anim) {
  drawPie(act.time || [], anim);
  const utils = act.utilities || [];
  $('utilities').innerHTML = utils.length ? utils.map(u => `<div class="util">
      <span>${esc(u.name)}<br><span class="muted small">last ${esc(ago(u.last))}</span></span>
      <span class="n">${u.count}</span></div>`).join('')
    : '<div class="empty">No auto utilities used in this period.</div>';
  const names = Object.fromEntries(devices.map(d => [d.id, d.name]));
  const hunts = act.hunts || [];
  $('hunts').innerHTML = hunts.length ? hunts.map(h => `<div class="util">
      <span>${esc(h.name)}${devices.length > 1 ? ' <span class="muted small">· ' + esc(names[h.device_id] || '') + '</span>' : ''}</span>
      <span class="muted small">${esc(ago(h.at))}</span></div>`).join('')
    : '<div class="empty">No hunts seen in this period. Turn on the Hunt Detector in ALware to log them.</div>';
  lastHunts = hunts;
  drawNow();
}

// "Right now" under the devices: what the watched Mac is doing, its weather,
// and hunts seen in the last 15 minutes.
let lastHunts = [];
// The same rows and icons as ALware's status HUD. Each category can hold
// several conditions at once (a weather plus Rainbow, say).
const CONDITION_ROWS = [['Time', 'Time'], ['Season', 'Season'], ['Weather', 'Weather'],
                        ['Sovereign Weather', 'Sovereign'], ['Surge', 'Surge']];
function conditionNames(value) {
  if (Array.isArray(value)) return value.flatMap(conditionNames);
  if (value == null || value === '' || value === 'None') return [];
  // Older ALware sent Python tuples as text: "('Nighttime',)".
  const listed = String(value).match(/'([^']+)'|"([^"]+)"/g);
  return listed ? listed.map(n => n.slice(1, -1)) : [String(value)];
}
function conditionList(cond) {
  const time = conditionNames(cond.Time)[0];
  return `<div class="conds">${CONDITION_ROWS.map(([key, label]) => {
    const names = conditionNames(cond[key]).map(n => n === 'Day/Night of the Luminous'
      ? (time === 'Nighttime' ? 'Night' : time === 'Daytime' ? 'Day' : 'Day/Night') + ' of the Luminous' : n);
    const raw = conditionNames(cond[key]);
    const icons = raw.map(n => typeof CONDITION_ICONS !== 'undefined' && CONDITION_ICONS[n]
      ? `<img class="cond-icon" src="${CONDITION_ICONS[n]}" alt="">` : '').join('');
    return `<div class="cond"><span class="cond-label">${label}</span><span class="cond-icons">${icons}</span>`
      + `<span class="cond-name${names.length ? '' : ' none'}">${names.length ? esc(names.join(', ')) : '—'}</span></div>`;
  }).join('')}</div>`;
}
function drawNow() {
  const box = $('now'), dev = liveDevice();
  const st = (dev && dev.status) || {};
  if (!dev || !dev.online) { box.hidden = true; return; }
  const cond = st.conditions && typeof st.conditions === 'object' ? st.conditions : null;
  const recent = lastHunts.filter(h => String(h.device_id) === String(dev.id) && Date.now() - new Date(h.at) < 15 * 60e3);
  box.hidden = false;
  box.innerHTML = `
    <div class="row"><span class="k">Doing</span><span>${esc(st.running ? (st.phase || 'Fishing') : 'Stopped')}</span></div>
    <div class="row top"><span class="k">Weather</span>${cond ? conditionList(cond)
      : '<span class="muted small">Not detected. Set the Weather &amp; Surge region in ALware.</span>'}</div>
    <div class="row"><span class="k">Active hunts</span>${recent.length
      ? [...new Set(recent.map(h => h.name))].map(n => `<span class="chip hunt">${esc(n)}</span>`).join(' ')
      : '<span class="muted small">None in the last 15 min</span>'}</div>`;
}

// "New session": the report only counts what happened after resetAt.
let resetAt = null;
async function loadReset() {
  const {data, error} = await sb.from('stat_resets').select('reset_at').maybeSingle();
  resetAt = !error && data ? new Date(data.reset_at) : null;   // table missing until schema.sql is re-run
  drawSessionNote();
}
function drawSessionNote() {
  const note = $('session-note'), range = $('range');
  let opt = range.querySelector('option[value="session"]');
  if (resetAt && !opt) {
    opt = document.createElement('option');
    opt.value = 'session';
    opt.textContent = 'This session';
    range.prepend(opt);
  } else if (!resetAt && opt) {
    if (range.value === 'session') range.value = '24';
    opt.remove();
  }
  note.hidden = !resetAt;
  if (resetAt) {
    note.innerHTML = `Counting since ${esc(resetAt.toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}))}`
      + ` (${esc(ago(resetAt.toISOString()))}). <button type="button" id="all-time">Show all time</button>`;
    $('all-time').onclick = () => setReset(false);
  }
}
async function setReset(on) {
  if (on && !confirm('Start a new session?\n\nThe report and charts will count from zero starting now. Nothing is deleted: "Show all time" brings the old numbers back.')) return;
  try { await rpc('reset_stats', {p_on: on}); }
  catch (e) { alert('Could not start a new session: ' + e.message + '\n\nIf this is new, re-run supabase/schema.sql in the Supabase SQL Editor.'); return; }
  await loadReset();
  if (on) $('range').value = 'session';
  await loadReport();
}
$('new-session').onclick = () => setReset(true);

function reportHours() {
  if ($('range').value === 'session' && resetAt)
    return Math.max(1, Math.min(336, Math.ceil((Date.now() - resetAt.getTime()) / 3600e3)));
  return Number($('range').value) || 24;
}

// Charts and the catch list animate in when what they show changes (first
// load, range, device, new session), not on the 30 s refresh or a resize.
let animNext = true, reportKey = '';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function animate(el, on) {
  el.classList.remove('anim');
  if (!on || reduceMotion.matches) return;
  void el.getBoundingClientRect();   // restart the CSS animations
  el.classList.add('anim');
}
// Numbers count up from what was showing before.
function countTo(el, value) {
  const m = /^(-?\d+(?:\.\d+)?)(.*)$/.exec(String(value));
  const from = parseFloat(el.dataset.n);
  el.dataset.n = m ? m[1] : '';
  if (!m || reduceMotion.matches || from === Number(m[1])) { el.textContent = value; return; }
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  const to = Number(m[1]), digits = (m[1].split('.')[1] || '').length, start = isNaN(from) ? 0 : from;
  const t0 = performance.now(), ms = 800;
  const step = now => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = (start + (to - start) * e).toFixed(digits) + m[2];
    if (k < 1 && el.dataset.n === m[1]) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let lastHours = [], lastAvg = 0;
async function loadReport() {
  drawSessionNote();
  const hours = reportHours();
  const device = $('report-device').value ? Number($('report-device').value) : null;
  const rep = await rpc('hourly_report', {p_hours: hours, p_tz: tz, p_device: device});
  const since = Math.max(Date.now() - hours * 3600e3, resetAt ? resetAt.getTime() : 0);
  let q = sb.from('catches').select('at, name, rarity, weight, mutation, rare_find, device_id')
    .gte('at', new Date(since).toISOString()).order('at', {ascending: false}).limit(1000);
  if (device) q = q.eq('device_id', device);
  const {data: catches, error} = await q;
  if (error) throw error;

  const t = rep.totals;
  const landRate = t.casts ? Math.round((t.casts - t.lost) / t.casts * 100) + '%' : '—';
  const key = [hours, device, resetAt && resetAt.getTime(), $('range').value].join('|');
  if (key !== reportKey) { animNext = true; reportKey = key; }
  const anim = animNext;
  animNext = false;
  const stats = [
    ['Fish caught', t.fish], ['Per hour fishing', t.per_hour ?? '—'], ['Hours fishing', t.run_hours],
    ['Catch rate', landRate], ['Rare finds', t.rare_finds],
  ];
  if ($('stats').children.length !== stats.length)
    $('stats').innerHTML = stats.map(([k]) => `<div class="stat"><div class="v"></div><div class="k">${k}</div></div>`).join('');
  stats.forEach(([, v], i) => countTo($('stats').children[i].querySelector('.v'), v));

  lastHours = rep.hours || [];
  lastAvg = t.per_hour || 0;
  $('avg-note').textContent = t.per_hour ? `average ${t.per_hour} fish per hour fishing` : '';
  drawFishChart(lastHours, lastAvg, anim);
  drawCaughtLost(lastHours, anim);
  rpc('activity_report', {p_hours: hours, p_device: device}).then(a => drawActivity(a, anim)).catch(e => console.error(e));
  const rows = lastHours.filter(h => h.casts || h.named).reverse();
  $('hour-rows').innerHTML = rows.length ? rows.map(h => {
    const rate = h.casts ? Math.round((h.casts - h.lost) / h.casts * 100) + '%' : '—';
    const rar = Object.entries(h.rarities).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${rarity(k)} ${v}`).join('&nbsp;&nbsp; ');
    return `<tr><td>${esc(hourLabel(h.start, true))}</td><td class="num">${h.fish}</td>
      <td class="num">${h.lost}</td><td class="num">${rate}</td><td>${rar || '<span class="muted">—</span>'}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">No fishing in this period yet.</td></tr>';

  periodCatches = catches;
  fillCatchFilters();
  drawCatches(anim);
}

// Recent catches: search and filters run on the period's catches (newest 1000).
let periodCatches = [];
function weightKg(w) {
  const m = /([\d.,]+)\s*(kg|g|lbs?)/i.exec(w || '');
  if (!m) return null;
  let n = m[1];
  n = /,\d{3}(?!\d)/.test(n) ? n.replace(/,/g, '') : n.replace(',', '.');   // 1,234 vs 12,5
  const v = parseFloat(n);
  if (!isFinite(v)) return null;
  const unit = m[2].toLowerCase();
  return unit === 'g' ? v / 1000 : unit.startsWith('lb') ? v * 0.4536 : v;
}
function fillOptions(sel, first, values) {
  const keep = sel.value;
  sel.innerHTML = first + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value = values.includes(keep) || (keep === '-' && sel.querySelector('option[value="-"]')) ? keep : '';
}
function fillCatchFilters() {
  const order = Object.keys(RARITY_COLORS);
  const rank = r => { const i = order.indexOf(r); return i < 0 ? 99 : i; };
  const rar = [...new Set(periodCatches.map(c => c.rarity).filter(Boolean))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const mut = [...new Set(periodCatches.map(c => c.mutation).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  fillOptions($('cf-rarity'), '<option value="">All rarities</option>', rar);
  fillOptions($('cf-mutation'), '<option value="">All mutations</option><option value="-">No mutation</option>', mut);
}
function catchFilters() {
  const num = id => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
  return {text: $('cf-search').value.trim().toLowerCase(), rarity: $('cf-rarity').value,
          mutation: $('cf-mutation').value, wmin: num('cf-wmin'), wmax: num('cf-wmax')};
}
function drawCatches(anim) {
  animate($('catch-rows'), anim !== false);
  const f = catchFilters();
  const active = !!(f.text || f.rarity || f.mutation || f.wmin != null || f.wmax != null);
  const catches = periodCatches.filter(c => {
    if (f.text && !`${c.name || ''} ${c.mutation || ''}`.toLowerCase().includes(f.text)) return false;
    if (f.rarity && c.rarity !== f.rarity) return false;
    if (f.mutation === '-' ? c.mutation : f.mutation && c.mutation !== f.mutation) return false;
    if (f.wmin != null || f.wmax != null) {
      const kg = weightKg(c.weight);
      if (kg == null || (f.wmin != null && kg < f.wmin) || (f.wmax != null && kg > f.wmax)) return false;
    }
    return true;
  });
  const shown = catches.slice(0, 200);
  $('cf-clear').hidden = !active;
  $('cf-count').textContent = !periodCatches.length ? '' : active
    ? `${catches.length} of ${periodCatches.length}${shown.length < catches.length ? `, showing newest ${shown.length}` : ''}`
    : `${periodCatches.length}${periodCatches.length >= 1000 ? '+' : ''} in this period${shown.length < catches.length ? `, showing newest ${shown.length}` : ''}`;
  const names = Object.fromEntries(devices.map(d => [d.id, d.name]));
  if (active && !catches.length) {
    $('catch-rows').innerHTML = '<tr><td colspan="6" class="empty">No catches match these filters.</td></tr>';
    return;
  }
  $('catch-rows').innerHTML = shown.length ? shown.map((c, i) => `<tr style="--d:${Math.min(i, 24)}">
      <td>${esc(new Date(c.at).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}))}</td>
      <td>${esc(c.name || 'Unknown')}${c.rare_find ? ' <span class="pill run">Rare Find</span>' : ''}</td>
      <td>${rarity(c.rarity)}</td><td>${esc(c.weight || '—')}</td><td>${esc(c.mutation || '—')}</td>
      <td class="muted">${esc(names[c.device_id] || '—')}</td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">No named catches yet. Fish names appear once ALware reads them.</td></tr>';
}

['cf-search', 'cf-wmin', 'cf-wmax'].forEach(id => $(id).addEventListener('input', () => drawCatches(true)));
['cf-rarity', 'cf-mutation'].forEach(id => $(id).addEventListener('change', () => drawCatches(true)));
$('cf-clear').onclick = () => {
  ['cf-search', 'cf-rarity', 'cf-mutation', 'cf-wmin', 'cf-wmax'].forEach(id => { $(id).value = ''; });
  drawCatches(true);
};

$('csv').onclick = async () => {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const {data, error} = await sb.from('catches').select('at, name, rarity, weight, mutation, rare_find')
      .order('at').range(from, from + 999);
    if (error) { alert(error.message); return; }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;   // keep spreadsheets from running it as a formula
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = ['time,name,rarity,weight,mutation,rare_find']
    .concat(rows.map(r => [cell(r.at), cell(r.name), cell(r.rarity), cell(r.weight), cell(r.mutation), r.rare_find ? 1 : 0].join(',')))
    .join('\n') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
  a.download = 'alware-catches.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

function startDashboard() {
  const fail = e => console.error(e);
  document.querySelectorAll('#view-dashboard .card').forEach((c, i) => c.style.setProperty('--i', i));
  $('range').onchange = $('report-device').onchange = () => loadReport().catch(fail);
  window.addEventListener('resize', () => { drawFishChart(lastHours, lastAvg); drawCaughtLost(lastHours); });
  loadDevices().then(loadReset).then(loadReport).catch(fail);
  setInterval(() => loadDevices().catch(fail), 5000);
  setInterval(() => loadReport().catch(fail), 30000);
  setInterval(watch, 3000);
  setInterval(drawLiveState, 1000);
}
})();
