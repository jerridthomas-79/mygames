/* Slide & Merge — flick items up a table; two of the same merge into the next size up. */
(() => {
'use strict';

// ---------- Config ----------
const THEMES = {
  fruit: [
    ['🫐', '#5a6fe0'], ['🍒', '#d8263f'], ['🍓', '#f0556a'], ['🍋', '#f2d23a'],
    ['🍊', '#f7962b'], ['🍎', '#e0402f'], ['🍑', '#f9a882'], ['🍍', '#e6bf35'],
    ['🥥', '#9a6a45'], ['🍈', '#b6dd6a'], ['🍉', '#3fae4a'],
  ],
  drinks: [
    ['🧃', '#7cc4f0'], ['☕', '#9b6a46'], ['🍵', '#8bc46a'], ['🥛', '#e8eef5'],
    ['🥤', '#e8443a'], ['🧋', '#c99a6b'], ['🍺', '#f0b22e'], ['🍷', '#9c2148'],
    ['🍸', '#55d0c8'], ['🍹', '#ff7a59'], ['🍾', '#2f8a4f'],
  ],
};
const TIERS = 11;
const radius = t => 0.42 + 0.16 * t;          // table units
const W = 8, HALF = W / 2, L = 22;              // table size
const LAUNCH_Y = 1.4, DANGER_Y = 3.6;           // launch spot, red line
const D = 17, CAM_H = 20;                   // camera distance & height
const FRICTION = 0.85, DECEL = 1.3;              // sliding friction
const WALL_BOUNCE = 0.55, BALL_BOUNCE = 0.35;
const POWER_EVERY = 1500;
const DANGER_TIME = 2.5;

// ---------- Storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const settings = Object.assign({ theme: 'fruit', sound: true, vibrate: true, tutorialDone: false }, store.get('sm.settings', {}));
const saveSettings = () => store.set('sm.settings', settings);
let best = store.get('sm.best', 0);

// ---------- DOM ----------
const $ = s => document.querySelector(s);
const canvas = $('#c'), ctx = canvas.getContext('2d');
const ui = {
  hud: $('#hud'), score: $('#score'), best: $('#best'), next: $('#next'), ladder: $('#ladder'),
  combo: $('#combo'), toast: $('#toast'), warning: $('#warning'), tutorial: $('#tutorial'),
  targetHint: $('#targetHint'), targetText: $('#targetText'),
  home: $('#home'), howto: $('#howto'), pause: $('#pause'), over: $('#over'),
};

// ---------- State ----------
let mode = 'home';             // home | play | paused | over
let theme = settings.theme;
let objs = [], shot = null, nextT = 0, lastAimX = 0, cooldown = 0;
let score = 0, highestTier = 0, merges = 0, combo = 0, comboTimer = 0;
let powers = { bomb: 1, upgrade: 1, shake: 1, swap: 1 }, nextPowerAt = POWER_EVERY;
let targeting = null, drag = null, gameTime = 0, shakeAmt = 0, saveTimer = 0;
let particles = [], popups = [], idSeq = 1;

// ---------- Layout / projection ----------
let cw = 0, ch = 0, dpr = 1, F = 1, cx = 0, hz = 0;
function layout() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  cw = window.innerWidth; ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  const topPad = 150, bottomPad = 100;
  const avail = Math.max(200, ch - topPad - bottomPad);
  const heightFactor = CAM_H * (1 / D - 1 / (L + D)); // table screen height per unit of F
  F = Math.min(cw * 0.94 * D / (W + 1), avail / heightFactor);
  const tableH = F * heightFactor;
  const bottomY = topPad + (avail + tableH) / 2;
  hz = bottomY - F * CAM_H / D;
  cx = cw / 2;
}
// table (x, y) -> screen [sx, sy, scale]
function P(x, y) { const z = y + D; const s = F / z; return [cx + x * s, hz + F * CAM_H / z, s]; }
function screenToTableX(px, y) { return (px - cx) * (y + D) / F; }

// ---------- Sprites ----------
const spriteCache = {};
function sprite(th, t) {
  const key = th + t;
  if (spriteCache[key]) return spriteCache[key];
  const S = 192, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), [emoji, color] = THEMES[th][t];
  const grd = g.createRadialGradient(S * .38, S * .32, S * .05, S / 2, S / 2, S / 2);
  grd.addColorStop(0, shade(color, 45)); grd.addColorStop(.7, color); grd.addColorStop(1, shade(color, -45));
  g.fillStyle = grd; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.fill();
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,.35)'; g.stroke();
  g.font = `${S * .6}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, S / 2, S / 2 + S * .04);
  g.fillStyle = 'rgba(255,255,255,.35)';
  g.beginPath(); g.ellipse(S * .36, S * .24, S * .16, S * .08, -.5, 0, Math.PI * 2); g.fill();
  return (spriteCache[key] = c);
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

// ---------- Audio / haptics ----------
let actx = null;
function ensureAudio() {
  if (actx || !settings.sound) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
}
function tone(freq, dur = .12, type = 'sine', vol = .15, slide = 0) {
  if (!settings.sound || !actx) return;
  const t0 = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(.001, t0 + dur);
  o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + .02);
}
const sfx = {
  flick: () => tone(300, .18, 'triangle', .12, 2.2),
  thud: v => tone(110 + Math.random() * 40, .08, 'sine', Math.min(.15, v * .02)),
  merge: t => { tone(330 * Math.pow(1.122, t), .18, 'sine', .18, 1.5); tone(660 * Math.pow(1.122, t), .12, 'triangle', .06); },
  power: () => tone(520, .25, 'square', .06, 1.8),
  bomb: () => tone(160, .4, 'sawtooth', .15, .3),
  over: () => { tone(400, .3, 'triangle', .15, .5); setTimeout(() => tone(250, .5, 'triangle', .15, .5), 250); },
};
function buzz(ms) { if (settings.vibrate && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }

// ---------- Game objects ----------
function makeObj(t, x, y) {
  return { id: idSeq++, t, r: radius(t), x, y, vx: 0, vy: 0, m: false, pop: 1, born: gameTime, danger: 0 };
}
function randTier() {
  const cap = Math.min(4, Math.max(2, highestTier - 1));
  const weights = [6, 5, 4, 2.5, 1.5].slice(0, cap + 1);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) { if ((r -= weights[i]) < 0) return i; }
  return 0;
}
function clampShotX(x, t) { const r = radius(t); return Math.max(-HALF + r, Math.min(HALF - r, x)); }
function spawnShot(t) {
  const tier = t != null ? t : nextT;
  if (t == null) nextT = randTier();
  shot = { t: tier, x: clampShotX(lastAimX, tier), pop: 0 };
  updateNext();
}

// ---------- New game / save ----------
function newGame() {
  theme = settings.theme;
  objs = []; particles = []; popups = [];
  score = 0; highestTier = 0; merges = 0; combo = 0; comboTimer = 0; gameTime = 0;
  powers = { bomb: 1, upgrade: 1, shake: 1, swap: 1 }; nextPowerAt = POWER_EVERY;
  lastAimX = 0; cooldown = 0; targeting = null;
  nextT = randTier(); spawnShot();
  store.del('sm.save');
  startPlay();
}
function saveGame() {
  if (mode !== 'play' && mode !== 'paused') return;
  store.set('sm.save', {
    theme, score, highestTier, merges, powers, nextPowerAt, nextT, gameTime,
    shotT: shot ? shot.t : nextT,
    objs: objs.filter(o => !o.m).map(o => ({ t: o.t, x: +o.x.toFixed(3), y: +o.y.toFixed(3) })),
  });
}
function loadGame() {
  const s = store.get('sm.save', null);
  if (!s) return false;
  theme = THEMES[s.theme] ? s.theme : 'fruit';
  score = s.score || 0; highestTier = s.highestTier || 0; merges = s.merges || 0;
  powers = Object.assign({ bomb: 0, upgrade: 0, shake: 0, swap: 0 }, s.powers);
  nextPowerAt = s.nextPowerAt || POWER_EVERY; gameTime = s.gameTime || 0;
  nextT = s.nextT || 0; objs = (s.objs || []).map(o => { const n = makeObj(o.t, o.x, o.y); n.born = -99; return n; });
  particles = []; popups = []; combo = 0; comboTimer = 0; targeting = null; lastAimX = 0;
  shot = { t: s.shotT || 0, x: 0, pop: 0 };
  updateNext();
  startPlay();
  return true;
}
function startPlay() {
  showScreen(null); mode = 'play';
  ui.hud.classList.remove('hidden');
  ui.tutorial.classList.toggle('hidden', settings.tutorialDone);
  ui.warning.classList.add('hidden');
  updateScore(); updateLadder(); updatePowers(); setTargeting(null);
}

// ---------- Input ----------
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'play') return;
  e.preventDefault(); ensureAudio();
  if (targeting) { handleTarget(e.clientX, e.clientY); return; }
  if (!shot) return;
  drag = { id: e.pointerId, sy: e.clientY, locked: false, lockX: 0, lockY: 0, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
  shot.x = clampShotX(screenToTableX(e.clientX, LAUNCH_Y), shot.t);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
canvas.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id || !shot) return;
  const now = performance.now();
  drag.samples.push({ x: e.clientX, y: e.clientY, t: now });
  while (drag.samples.length > 2 && now - drag.samples[0].t > 140) drag.samples.shift();
  if (!drag.locked) {
    if (drag.sy - e.clientY > 26) { drag.locked = true; drag.lockX = e.clientX; drag.lockY = e.clientY; }
    else shot.x = clampShotX(screenToTableX(e.clientX, LAUNCH_Y), shot.t);
  }
});
canvas.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (!d.locked || !shot || mode !== 'play') { if (shot) lastAimX = shot.x; return; }
  const now = performance.now();
  d.samples.push({ x: e.clientX, y: e.clientY, t: now });
  const first = d.samples[0], dt = Math.max(16, now - first.t) / 1000;
  const vUp = (first.y - e.clientY) / dt;                 // px/s upward
  const power = Math.max(.12, Math.min(1, vUp / (ch * 2.2)));
  const dy = Math.max(30, d.lockY - e.clientY + 26), dx = e.clientX - d.lockX;
  const dir = Math.max(-.45, Math.min(.45, (dx / dy) * .9));
  launch(power, dir);
});
canvas.addEventListener('pointercancel', () => { drag = null; });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

function currentAimDir() {
  if (!drag || !drag.locked || !drag.samples.length) return 0;
  const last = drag.samples[drag.samples.length - 1];
  const dy = Math.max(30, drag.lockY - last.y + 26);
  return Math.max(-.45, Math.min(.45, ((last.x - drag.lockX) / dy) * .9));
}

function launch(power, dir) {
  const speed = 7 + power * 21;
  const o = makeObj(shot.t, shot.x, LAUNCH_Y);
  o.vy = speed; o.vx = speed * dir; o.pop = 1;
  objs.push(o);
  lastAimX = shot.x; shot = null; cooldown = .45;
  sfx.flick(); buzz(8);
  if (!settings.tutorialDone) { settings.tutorialDone = true; saveSettings(); ui.tutorial.classList.add('hidden'); }
}

// ---------- Power-ups ----------
document.querySelectorAll('.power').forEach(b => b.addEventListener('click', () => usePower(b.dataset.p)));
$('#btnCancelTarget').addEventListener('click', () => setTargeting(null));
function usePower(p) {
  if (mode !== 'play') return;
  ensureAudio();
  if (targeting === p) { setTargeting(null); return; }
  if (!powers[p]) { toast('Earn more every 1,500 points'); return; }
  if (p === 'shake') {
    powers.shake--; sfx.power(); buzz([20, 30, 20]); shakeAmt = 10;
    objs.forEach(o => { o.vy += 5 + Math.random() * 3; o.vx += (Math.random() - .5) * 4; });
  } else if (p === 'swap') {
    if (!shot) return;
    powers.swap--; sfx.power();
    const t = shot.t; shot.t = nextT; nextT = t; shot.x = clampShotX(shot.x, shot.t); shot.pop = 0;
    updateNext();
  } else {
    if (!objs.length) { toast('Nothing on the table yet'); return; }
    setTargeting(p); return;
  }
  updatePowers();
}
function setTargeting(p) {
  targeting = p;
  ui.targetHint.classList.toggle('hidden', !p);
  if (p) ui.targetText.textContent = p === 'bomb' ? '💣 Tap an item to remove it' : '⬆️ Tap an item to upgrade it';
  document.querySelectorAll('.power').forEach(b => b.classList.toggle('active', b.dataset.p === p));
}
function handleTarget(px, py) {
  let hit = null, bestD = Infinity;
  for (const o of objs) {
    const [sx, sy, s] = P(o.x, o.y), R = o.r * s, cy = sy - R;
    const d = Math.hypot(px - sx, py - cy);
    if (d < R * 1.2 && d < bestD) { bestD = d; hit = o; }
  }
  if (!hit) return;
  const [sx, sy, s] = P(hit.x, hit.y), pos = [sx, sy - hit.r * s];
  if (targeting === 'bomb') {
    powers.bomb--; objs.splice(objs.indexOf(hit), 1);
    burst(pos[0], pos[1], '#ffb347', 26, 7); sfx.bomb(); buzz(40); shakeAmt = 8;
  } else if (targeting === 'upgrade') {
    if (hit.t >= TIERS - 1) { toast('Already the biggest!'); return; }
    powers.upgrade--; hit.t++; hit.r = radius(hit.t); hit.pop = 0; hit.born = gameTime;
    if (hit.t > highestTier) { highestTier = hit.t; updateLadder(); }
    burst(pos[0], pos[1], THEMES[theme][hit.t][1], 16, 5); sfx.power(); buzz(15);
  }
  setTargeting(null); updatePowers();
}

// ---------- Physics ----------
function update(dt) {
  gameTime += dt;
  const steps = 4, h = dt / steps;
  for (let i = 0; i < steps; i++) { integrate(h); collide(); }

  if (!shot) { cooldown -= dt; if (cooldown <= 0) spawnShot(); }
  if (shot) shot.pop = Math.min(1, shot.pop + dt * 5);
  for (const o of objs) o.pop = Math.min(1, o.pop + dt * 4);

  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) { combo = 0; ui.combo.classList.add('hidden'); } }

  // danger line
  let worst = 0;
  for (const o of objs) {
    const sp = Math.hypot(o.vx, o.vy);
    if (gameTime - o.born > 1.2 && sp < .6 && o.y - o.r < DANGER_Y) o.danger += dt;
    else o.danger = Math.max(0, o.danger - dt * 2);
    worst = Math.max(worst, o.danger);
  }
  ui.warning.classList.toggle('hidden', worst < .4);
  if (worst > DANGER_TIME) { gameOver(); return; }

  saveTimer += dt;
  if (saveTimer > 4) { saveTimer = 0; saveGame(); }
}
function integrate(h) {
  const fr = Math.exp(-FRICTION * h);
  for (const o of objs) {
    o.vx *= fr; o.vy *= fr;
    const sp = Math.hypot(o.vx, o.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - DECEL * h);
      if (ns < .03) { o.vx = o.vy = 0; } else { o.vx *= ns / sp; o.vy *= ns / sp; }
    }
    o.x += o.vx * h; o.y += o.vy * h;
    if (o.x - o.r < -HALF) { o.x = -HALF + o.r; o.vx = Math.abs(o.vx) * WALL_BOUNCE; }
    if (o.x + o.r > HALF) { o.x = HALF - o.r; o.vx = -Math.abs(o.vx) * WALL_BOUNCE; }
    if (o.y + o.r > L) { o.y = L - o.r; if (o.vy > 2) sfx.thud(o.vy); o.vy = -Math.abs(o.vy) * WALL_BOUNCE; }
    if (o.y - o.r < 0) { o.y = o.r; o.vy = Math.abs(o.vy) * .3; }
  }
}
function collide() {
  const pending = [];
  for (let i = 0; i < objs.length; i++) {
    const a = objs[i]; if (a.m) continue;
    for (let j = i + 1; j < objs.length; j++) {
      const b = objs[j]; if (b.m) continue;
      const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r, d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      if (a.t === b.t) { a.m = b.m = true; pending.push([a, b]); break; }
      const d = Math.sqrt(d2) || .001, nx = dx / d, ny = dy / d, ov = rr - d;
      const ma = a.r * a.r, mb = b.r * b.r, tot = ma + mb;
      a.x -= nx * ov * mb / tot; a.y -= ny * ov * mb / tot;
      b.x += nx * ov * ma / tot; b.y += ny * ov * ma / tot;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const jimp = -(1 + BALL_BOUNCE) * rv / (1 / ma + 1 / mb);
        a.vx -= jimp * nx / ma; a.vy -= jimp * ny / ma;
        b.vx += jimp * nx / mb; b.vy += jimp * ny / mb;
        if (-rv > 3) sfx.thud(-rv);
      }
    }
  }
  for (const [a, b] of pending) doMerge(a, b);
}
function doMerge(a, b) {
  objs = objs.filter(o => o !== a && o !== b);
  const ma = a.r * a.r, mb = b.r * b.r, tot = ma + mb;
  const x = (a.x * ma + b.x * mb) / tot, y = (a.y * ma + b.y * mb) / tot;
  const [sx, sy, s] = P(x, y);
  merges++;
  combo = comboTimer > 0 ? combo + 1 : 1; comboTimer = 1.6;
  if (combo >= 2) { ui.combo.textContent = `COMBO x${combo}`; ui.combo.classList.remove('hidden'); }

  if (a.t === TIERS - 1) {   // two of the biggest: they vanish for a jackpot
    addScore(5000 * combo, sx, sy - a.r * s);
    burst(sx, sy - a.r * s, '#ffd65a', 60, 10); shakeAmt = 16; sfx.merge(TIERS); buzz([30, 40, 60]);
    toast('🎉 JACKPOT!');
    return;
  }
  const t = a.t + 1, o = makeObj(t, x, y);
  o.vx = (a.vx * ma + b.vx * mb) / tot * .5; o.vy = (a.vy * ma + b.vy * mb) / tot * .5; o.pop = 0;
  objs.push(o);
  const R = o.r * s;
  addScore(((t + 1) * (t + 2) / 2) * 10 * combo, sx, sy - R);
  burst(sx, sy - R, THEMES[theme][t][1], 10 + t * 2, 3 + t * .5);
  sfx.merge(t); buzz(12 + t * 3);
  if (t >= 7) shakeAmt = Math.max(shakeAmt, t);
  if (t > highestTier) {
    highestTier = t; updateLadder();
    if (t >= 3) toast(`New! ${THEMES[theme][t][0]}`);
  }
}
function addScore(n, sx, sy) {
  score += n; popups.push({ x: sx, y: sy, text: '+' + n, life: 1 });
  while (score >= nextPowerAt) {
    nextPowerAt += POWER_EVERY;
    const keys = ['bomb', 'upgrade', 'shake', 'swap'], k = keys[Math.floor(Math.random() * keys.length)];
    powers[k]++; updatePowers();
    toast(`Power-up earned: ${{ bomb: '💣', upgrade: '⬆️', shake: '🫨', swap: '🔄' }[k]}`);
  }
  updateScore();
}
function burst(x, y, color, n, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (.4 + Math.random()) * spd * 60;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 1, color, size: 2 + Math.random() * 4 });
  }
}

// ---------- Game over ----------
function gameOver() {
  mode = 'over'; drag = null; setTargeting(null);
  sfx.over(); buzz([60, 60, 120]);
  const isBest = score > best;
  if (isBest) { best = score; store.set('sm.best', best); }
  store.del('sm.save');
  $('#overScore').textContent = score.toLocaleString();
  $('#overBest').textContent = best.toLocaleString();
  $('#overBig').textContent = THEMES[theme][highestTier][0];
  $('#overMerges').textContent = merges;
  $('#newBest').classList.toggle('hidden', !isBest);
  ui.warning.classList.add('hidden');
  setTimeout(() => showScreen('over'), 600);
}

// ---------- UI helpers ----------
function updateScore() {
  ui.score.textContent = score.toLocaleString();
  ui.best.textContent = Math.max(best, score).toLocaleString();
}
function updateNext() { ui.next.textContent = THEMES[theme][nextT][0]; }
function updateLadder() {
  ui.ladder.innerHTML = THEMES[theme].map(([e], i) =>
    i <= highestTier ? `<span class="${i === highestTier ? 'top' : ''}">${e}</span>` : `<span class="unknown">?</span>`).join('');
}
function updatePowers() {
  document.querySelectorAll('.power').forEach(b => {
    const n = powers[b.dataset.p] || 0;
    b.querySelector('b').textContent = n; b.classList.toggle('empty', !n);
  });
}
let toastTimer = 0;
function toast(msg) {
  ui.toast.textContent = msg; ui.toast.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.add('hidden'), 1400);
}
function showScreen(name) {
  ['home', 'howto', 'pause', 'over'].forEach(n => ui[n].classList.toggle('hidden', n !== name));
}
function refreshHome() {
  $('#homeBest').textContent = best.toLocaleString();
  $('#btnContinue').classList.toggle('hidden', !store.get('sm.save', null));
  $('#btnPlay').textContent = store.get('sm.save', null) ? 'New game' : 'Play';
  document.querySelectorAll('.theme-pick button').forEach(b => b.classList.toggle('on', b.dataset.theme === settings.theme));
  $('#homeLadder').innerHTML = THEMES[settings.theme].map(([e]) => `<span>${e}</span>`).join('');
}
function refreshToggles() {
  $('#tglSound').textContent = `🔊 Sound: ${settings.sound ? 'On' : 'Off'}`;
  $('#tglVibe').textContent = `📳 Vibration: ${settings.vibrate ? 'On' : 'Off'}`;
}
function goHome() {
  saveGame(); mode = 'home'; ui.hud.classList.add('hidden'); setTargeting(null);
  if (!store.get('sm.save', null)) { objs = []; shot = null; }
  refreshHome(); showScreen('home');
}
function pauseGame() {
  if (mode !== 'play') return;
  mode = 'paused'; drag = null; saveGame(); refreshToggles(); showScreen('pause');
}

// buttons
$('#btnPlay').addEventListener('click', () => { ensureAudio(); newGame(); });
$('#btnContinue').addEventListener('click', () => { ensureAudio(); loadGame(); });
$('#btnHow').addEventListener('click', () => showScreen('howto'));
$('#btnHowBack').addEventListener('click', () => { mode === 'home' ? showScreen('home') : showScreen(null); });
$('#btnPause').addEventListener('click', pauseGame);
$('#btnResume').addEventListener('click', () => { showScreen(null); mode = 'play'; });
$('#btnRestart').addEventListener('click', newGame);
$('#btnHome').addEventListener('click', goHome);
$('#btnAgain').addEventListener('click', newGame);
$('#btnOverHome').addEventListener('click', goHome);
$('#tglSound').addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); ensureAudio(); refreshToggles(); });
$('#tglVibe').addEventListener('click', () => { settings.vibrate = !settings.vibrate; saveSettings(); refreshToggles(); buzz(20); });
document.querySelectorAll('.theme-pick button').forEach(b => b.addEventListener('click', () => {
  settings.theme = b.dataset.theme; saveSettings(); refreshHome();
}));
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveGame(); pauseGame(); } });
window.addEventListener('pagehide', saveGame);
window.addEventListener('resize', layout);

// ---------- Rendering ----------
function poly(pts) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }
function drawTable(warn) {
  const bg = ctx.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, '#2b1a4f'); bg.addColorStop(1, '#140b26');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);

  // rail / frame
  const rw = .55;
  const fl = P(-HALF - rw, -rw), fr = P(HALF + rw, -rw), br = P(HALF + rw, L + rw), bl = P(-HALF - rw, L + rw);
  ctx.fillStyle = '#5a3420'; poly([fl, fr, br, bl]); ctx.fill();
  // rail front face
  ctx.fillStyle = '#3d2214';
  poly([fl, fr, [fr[0], fr[1] + 14], [fl[0], fl[1] + 14]]); ctx.fill();
  // far wall face
  const wallH = .9;
  ctx.fillStyle = '#6b4128';
  poly([bl, br, [br[0], br[1] - wallH * br[2]], [bl[0], bl[1] - wallH * bl[2]]]); ctx.fill();

  // surface
  const n0 = P(-HALF, 0), n1 = P(HALF, 0), f1 = P(HALF, L), f0 = P(-HALF, L);
  const sg = ctx.createLinearGradient(0, n0[1], 0, f0[1]);
  sg.addColorStop(0, '#2fa58a'); sg.addColorStop(1, '#1d6f62');
  ctx.fillStyle = sg; poly([n0, n1, f1, f0]); ctx.fill();

  // lanes
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
  for (let x = -HALF + 1.5; x < HALF; x += 1.5) {
    const a = P(x, 0), b = P(x, L); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  for (let y = 4; y < L; y += 4) {
    const a = P(-HALF, y), b = P(HALF, y); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }

  // launch zone & danger line
  const d0 = P(-HALF, DANGER_Y), d1 = P(HALF, DANGER_Y);
  const pulse = warn ? .25 + .2 * Math.sin(gameTime * 14) : .08;
  ctx.fillStyle = `rgba(255,70,70,${pulse})`; poly([n0, n1, d1, d0]); ctx.fill();
  ctx.setLineDash([10, 8]); ctx.lineWidth = 3; ctx.strokeStyle = warn ? '#ff4d4d' : 'rgba(255,90,90,.75)';
  ctx.beginPath(); ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); ctx.stroke(); ctx.setLineDash([]);
}
function drawItem(t, x, y, r, pop, danger, ghost) {
  const [sx, sy, s] = P(x, y);
  const k = pop < 1 ? .55 + .45 * easeOutBack(pop) : 1;
  const R = r * s * k;
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(sx, sy, R * .95, R * .38, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = ghost ? .9 : 1;
  ctx.drawImage(sprite(theme, t), sx - R, sy - R * 2, R * 2, R * 2);
  if (danger > .3) {
    ctx.strokeStyle = `rgba(255,60,60,${.5 + .5 * Math.sin(gameTime * 16)})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(sx, sy - R, R + 2, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function easeOutBack(t) { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
function drawAimGuide() {
  if (!shot || mode !== 'play' || targeting) return;
  const dir = currentAimDir();
  ctx.fillStyle = drag ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.22)';
  const r = radius(shot.t);
  for (let y = LAUNCH_Y + r + .6; y < L - .3; y += .9) {
    const x = shot.x + dir * (y - LAUNCH_Y);
    if (x < -HALF + .1 || x > HALF - .1) break;
    const [sx, sy, s] = P(x, y);
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.5, .09 * s), 0, Math.PI * 2); ctx.fill();
  }
}
function render(dt) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let ox = 0, oy = 0;
  if (shakeAmt > 0) { ox = (Math.random() - .5) * shakeAmt; oy = (Math.random() - .5) * shakeAmt; shakeAmt = Math.max(0, shakeAmt - dt * 40); }
  ctx.translate(ox, oy);
  const warn = !ui.warning.classList.contains('hidden');
  drawTable(warn && mode === 'play');
  drawAimGuide();

  const list = objs.map(o => ({ t: o.t, x: o.x, y: o.y, r: o.r, pop: o.pop, danger: o.danger }));
  if (shot && (mode === 'play' || mode === 'paused')) list.push({ t: shot.t, x: shot.x, y: LAUNCH_Y, r: radius(shot.t), pop: shot.pop, danger: 0, ghost: true });
  list.sort((a, b) => b.y - a.y);
  for (const it of list) drawItem(it.t, it.x, it.y, it.r, it.pop, it.danger, it.ghost);

  // targeting highlight
  if (targeting) {
    ctx.strokeStyle = 'rgba(255,214,90,.9)'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    for (const o of objs) { const [sx, sy, s] = P(o.x, o.y), R = o.r * s; ctx.beginPath(); ctx.arc(sx, sy - R, R + 3, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  // particles
  for (const p of particles) {
    p.life -= dt * 1.6; p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  particles = particles.filter(p => p.life > 0);
  // score popups
  ctx.textAlign = 'center'; ctx.font = '900 20px -apple-system, sans-serif';
  for (const p of popups) {
    p.life -= dt * 1.1; p.y -= 50 * dt;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = '#fff'; ctx.fillText(p.text, p.x, p.y);
  }
  popups = popups.filter(p => p.life > 0);
  ctx.globalAlpha = 1;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(.033, (now - last) / 1000); last = now;
  if (mode === 'play' && !targeting) update(dt);
  render(dt);
  requestAnimationFrame(frame);
}

// ---------- Boot ----------
layout(); refreshHome(); showScreen('home');
requestAnimationFrame(frame);

// tiny debug hook for testing
window.__sm = { get objs() { return objs; }, get mode() { return mode; }, get score() { return score; }, launch: (p, d) => shot && launch(p, d) };
})();
