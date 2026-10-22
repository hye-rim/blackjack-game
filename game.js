'use strict';

// 블랙잭: 화면·입력·소리. 규칙은 logic.js. 칩은 게임용이며 실제 돈과 무관하다
const L = LOGIC_BJ;
const $ = (id) => document.getElementById(id);
const INK = '#2b1d52';
const W = 360, H = 560;
const CW = 54, CH = 76;                                   // 카드 크기

// ---------- 캔버스 ----------
const canvas = $('game');
const ctx = canvas.getContext('2d');
function fit() {
  const hudH = 52;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - hudH) / H, 1.5);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = cssW + 'px';
}
addEventListener('resize', fit);

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
// 예전 판(블랙잭 3:2 를 반 칩까지 주던 때)에 저장된 1,007.5 같은 값은 내려서 쓴다
const savedChips = store.get('blackjackChips') === null ? null : String(Math.floor(Number(store.get('blackjackChips')) || 0));
let best = Math.floor(Number(store.get('blackjackBest')) || 0);
if (savedChips !== null && store.get('blackjackChips') !== savedChips) store.set('blackjackChips', savedChips);
if (store.get('blackjackBest') !== null && store.get('blackjackBest') !== String(best)) store.set('blackjackBest', String(best));   // 로비 카드도 내린 값을 읽게
function save() {
  store.set('blackjackChips', String(st.chips));        // 판돈을 건 순간에도 저장: 새로고침으로 진 판을 없던 일로 못 하게
  if (st.bestChips > best) { best = st.bestChips; store.set('blackjackBest', String(best)); }
}

// ---------- 소리 ----------
let audio = null;
let muted = store.get('blackjackMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  card: () => tone(700, 0.05, 'triangle', 0.05, -300),
  chip: () => { tone(1500, 0.04, 'square', 0.03); setTimeout(() => tone(1900, 0.04, 'square', 0.03), 35); },
  win: () => seq([523, 659, 784], 80, 'triangle', 0.1),
  bj: () => seq([523, 659, 784, 1047, 1319], 85, 'triangle', 0.11),
  push: () => tone(440, 0.12, 'triangle', 0.06),
  lose: () => tone(240, 0.28, 'sawtooth', 0.06, -120),
  nope: () => tone(190, 0.08, 'square', 0.04, -50),
};
function toggleMute() { muted = !muted; store.set('blackjackMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
const EMPTY = L.newGame(0, 1);                           // 타이틀 뒤에 깔아 둘 빈 테이블
let st = L.newGame(L.START_CHIPS);
let mode = 'title';                                      // title | table | menu
let uiT = 0, flash = 0, toast = null;
let born = new Map();                                    // 카드가 놓인(날아오는) 시각: 'd:0' 딜러 첫 장, 'h1:2' 첫 손 세 번째 …
let nextDelay = 0, dealerTimer = 0, revealAt = 0, settledShownAt = 0, shownChips = L.START_CHIPS, floats = [];
const buttons = [];

function updateHud() { $('score').textContent = Math.round(shownChips).toLocaleString('ko-KR'); $('best').textContent = best.toLocaleString('ko-KR'); }
function say(text, ms = 1600) { toast = { text, until: uiT + ms / 1000 }; }
function floatText(x, y, text, color) { floats.push({ x, y, text, color, t: 0 }); }
const fmt = (n) => n.toLocaleString('ko-KR');

function resetTable() { born = new Map(); nextDelay = 0; dealerTimer = 0; revealAt = 0; settledShownAt = 0; }

// ---------- 동작 ----------
function doDeal() {
  if (!L.canDeal(st)) { sfx.nope(); return; }
  resetTable();
  L.deal(st); save(); shownChips = st.chips; updateHud(); sfx.chip();
  if (st.shuffled) say('카드를 새로 섞었어요 🔀', 1800);
}
function act(fn) {
  if (st.phase !== 'player') return;
  if (!fn(st)) { sfx.nope(); return; }
  save(); shownChips = st.chips; updateHud();
}
function doNext() {
  if (st.phase !== 'settle') return;
  L.nextRound(st); resetTable();
  if (L.isBroke(st)) { showBroke(); return; }
}
function addChip(v) {
  if (st.phase !== 'bet') return;
  if (!L.addBet(st, v)) { sfx.nope(); say(st.bet + v > L.MAX_BET ? `한 판에 최대 ${fmt(L.MAX_BET)}칩까지예요` : '칩이 모자라요', 1200); return; }
  sfx.chip();
}

// ---------- 입력 ----------
function toLocal(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (mode !== 'table') return;
  const { x, y } = toLocal(e);
  for (const b of buttons) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { if (b.enabled) b.on(); else sfx.nope(); return; }
  }
});
addEventListener('keydown', (e) => {
  if (e.repeat || mode !== 'table') return;
  const k = e.code;
  if (st.phase === 'bet') {
    if (/^Digit[1-5]$/.test(k)) addChip(L.CHIP_VALUES[Number(k.slice(5)) - 1]);
    else if (k === 'Backspace' || k === 'KeyC') L.clearBet(st);
    else if (k === 'KeyR') { if (L.repeatBet(st)) sfx.chip(); }
    else if (k === 'Enter' || k === 'Space') { e.preventDefault(); doDeal(); }
  } else if (st.phase === 'player') {
    if (k === 'KeyH') act(L.hit); else if (k === 'KeyS') act(L.stand); else if (k === 'KeyD') act(L.double); else if (k === 'KeyP') act(L.split);
  } else if (st.phase === 'settle' && (k === 'Enter' || k === 'Space')) { e.preventDefault(); doNext(); }
  if (k === 'KeyM') toggleMute();
});

// ---------- 메뉴 ----------
let confirmReset = false;
function showTitle() {
  mode = 'title';
  const has = savedChips !== null && Number(savedChips) >= L.MIN_BET;
  $('overlay').innerHTML = `
    <h1>블랙잭</h1>
    <p>21에 가깝게 만들되 넘으면 져요<br>블랙잭은 <b>3 : 2</b> · 딜러는 17에서 멈춰요<br><b>더블</b>·<b>스플릿</b>도 할 수 있어요</p>
    <p style="font-size:12px;opacity:.85">🎰 칩은 게임용이에요. 실제 돈과는 상관없어요</p>
    <div class="col">
      ${has ? `<button id="contBtn">이어서 하기<small>칩 ${fmt(Number(savedChips))}</small></button><button id="newBtn" class="sub">처음부터 (칩 ${fmt(L.START_CHIPS)})</button>` : `<button id="newBtn">시작하기<small>칩 ${fmt(L.START_CHIPS)}개로 시작</small></button>`}
    </div>
    <p style="font-size:12px;opacity:.85">PC: H 히트 · S 스탠드 · D 더블 · P 스플릿 · 1~5 칩 · Enter 딜</p>`;
  $('overlay').classList.remove('hidden');
  if (has) $('contBtn').onclick = (e) => { e.currentTarget.blur(); startTable(Number(savedChips)); };
  $('newBtn').onclick = (e) => { e.currentTarget.blur(); startTable(L.START_CHIPS); };
}
function startTable(chips) {
  st = L.newGame(chips);
  best = Math.max(best, chips);
  resetTable(); shownChips = chips; floats = [];
  mode = 'table'; $('overlay').classList.add('hidden');
  save(); updateHud();
}
function showBroke() {
  mode = 'menu';
  $('overlay').innerHTML = `
    <h2>칩이 바닥났어요 💸</h2>
    <p>최고로 모았던 칩은 <b>${fmt(best)}</b>개!</p>
    <div class="col"><button id="againBtn">다시 시작<small>칩 ${fmt(L.START_CHIPS)}개</small></button></div>`;
  $('overlay').classList.remove('hidden');
  $('againBtn').onclick = (e) => { e.currentTarget.blur(); startTable(L.START_CHIPS); };
}
function showMenu() {
  if (mode !== 'table') return;
  mode = 'menu'; confirmReset = false;
  $('overlay').innerHTML = `
    <h2>메뉴</h2>
    <p>지금 칩 <b>${fmt(st.chips)}</b>개 · 최고 <b>${fmt(best)}</b></p>
    <p style="font-size:12px;opacity:.85">${st.phase === 'bet' || st.phase === 'settle' ? '' : '※ 진행 중인 판에서 나가면 건 칩은 돌아오지 않아요'}</p>
    <div class="col"><button id="resumeBtn">계속하기</button><button id="resetBtn" class="sub">처음부터 다시</button></div>`;
  $('overlay').classList.remove('hidden');
  $('resumeBtn').onclick = hideMenu;
  $('resetBtn').onclick = (e) => {
    if (!confirmReset) { confirmReset = true; e.currentTarget.textContent = '정말 처음부터? (칩 1,000)'; return; }
    startTable(L.START_CHIPS);
  };
}
function hideMenu() { if (mode !== 'menu') return; mode = 'table'; $('overlay').classList.add('hidden'); }
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); mode === 'menu' ? hideMenu() : showMenu(); };

// ---------- 그리기 도구 ----------
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_COL = ['#2b1d52', '#e0357f', '#e0357f', '#2b1d52'];
const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };

function drawCard(x, y, card, faceUp, sx = 1, dim = false) {
  ctx.save(); ctx.translate(x + CW / 2, y + CH / 2); ctx.scale(Math.max(0.02, sx), 1); ctx.translate(-CW / 2, -CH / 2);
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = INK;
  ctx.fillStyle = 'rgba(43,29,82,.25)'; rr(2, 4, CW, CH, 8); ctx.fill();
  if (faceUp) {
    ctx.fillStyle = '#fff'; rr(0, 0, CW, CH, 8); ctx.fill(); ctx.stroke();
    const r = L.rankOf(card), s = L.suitOf(card), col = SUIT_COL[s];
    ctx.fillStyle = col; ctx.textAlign = 'center';
    ctx.font = `${r === 9 ? 17 : 20}px Jua, sans-serif`; ctx.fillText(RANKS[r], 14, 22);
    ctx.font = '15px Jua, sans-serif'; ctx.fillText(SUITS[s], 14, 38);
    ctx.font = '34px Jua, sans-serif'; ctx.fillText(SUITS[s], CW / 2 + 6, CH - 16);
  } else {
    ctx.fillStyle = '#ff5fa2'; rr(0, 0, CW, CH, 8); ctx.fill(); ctx.stroke();
    ctx.save(); rr(5, 5, CW - 10, CH - 10, 5); ctx.clip();
    ctx.fillStyle = '#ffd23f'; for (let i = -CH; i < CW + CH; i += 14) { ctx.save(); ctx.translate(i, 0); ctx.rotate(0.6); ctx.fillRect(0, -10, 6, CH + 40); ctx.restore(); }
    ctx.restore();
    ctx.lineWidth = 2.5; rr(5, 5, CW - 10, CH - 10, 5); ctx.stroke();
  }
  if (dim) { ctx.fillStyle = 'rgba(43,29,82,.35)'; rr(0, 0, CW, CH, 8); ctx.fill(); }
  ctx.restore();
}
const ease = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

const CHIP_COL = { 5: ['#ff5f7a', '#fff'], 10: ['#3fb6ff', '#fff'], 25: ['#4cd964', '#fff'], 100: ['#3a3a4a', '#ffd23f'], 500: ['#a055e8', '#ffd23f'] };
function drawChip(x, y, v, r = 24, label = true) {
  const [a, b] = CHIP_COL[v] || CHIP_COL[5];
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = 3; ctx.strokeStyle = INK;
  ctx.fillStyle = 'rgba(43,29,82,.3)'; ctx.beginPath(); ctx.ellipse(1, 4, r, r * 0.95, 0, 0, 7); ctx.fill();
  ctx.fillStyle = a; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = b; ctx.lineWidth = r * 0.28; ctx.setLineDash([r * 0.42, r * 0.42]); ctx.beginPath(); ctx.arc(0, 0, r - r * 0.14, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = b; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, 7); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, 7); ctx.stroke();
  if (label) { ctx.fillStyle = INK; ctx.font = `${v >= 100 ? r * 0.58 : r * 0.7}px Jua, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(v, 0, r * 0.25); }
  ctx.restore();
}
function drawBetStack(x, y, amount) {
  // 금액을 큰 칩부터 쪼개서 쌓는다 (최대 10개만 그린다)
  const stack = []; let left = amount;
  for (const v of [500, 100, 25, 10, 5].filter((v) => L.CHIP_VALUES.includes(v))) while (left >= v && stack.length < 10) { stack.push(v); left -= v; }
  stack.forEach((v, i) => drawChip(x, y - i * 5, v, 22, false));
  if (stack.length) drawChip(x, y - (stack.length - 1) * 5, stack[stack.length - 1], 22, false);
}
function button(id, label, x, y, w, h, enabled, color, on, sub) {
  buttons.push({ id, x, y, w, h, enabled, on });
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = INK;
  ctx.fillStyle = INK; rr(x, y + 4, w, h, 14); ctx.fill();
  ctx.fillStyle = enabled ? color : '#b9b3cf'; rr(x, y, w, h, 14); ctx.fill(); ctx.stroke();
  ctx.fillStyle = enabled ? INK : '#7d7699'; ctx.textAlign = 'center';
  ctx.font = `${sub ? 20 : 22}px Jua, sans-serif`; ctx.fillText(label, x + w / 2, y + h / 2 + (sub ? 2 : 7));
  if (sub) { ctx.font = '11px Jua, sans-serif'; ctx.fillText(sub, x + w / 2, y + h - 8); }
  ctx.restore();
}
function banner(text, x, y, color, fg = '#fff') {
  ctx.font = '18px Jua, sans-serif'; const w = ctx.measureText(text).width + 24;
  ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.fillStyle = color; rr(x - w / 2, y - 16, w, 30, 15); ctx.fill(); ctx.stroke();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.fillText(text, x, y + 5);
}

// ---------- 테이블 그리기 ----------
function cardPos(cards, cx, y, maxSpread) {
  const n = cards.length, sp = Math.min(maxSpread, n > 1 ? (W - 40 - CW) / (n - 1) : maxSpread);
  const total = CW + sp * (n - 1), x0 = cx - total / 2;
  return cards.map((_, i) => ({ x: x0 + i * sp, y }));
}

// 새로 생긴 카드마다 날아오는 시각을 정해 준다 (한 프레임에 여러 장이면 0.2초씩 차례로)
function stampBorn() {
  const check = (key) => {
    if (born.has(key)) return;
    nextDelay = Math.max(nextDelay, uiT);
    born.set(key, nextDelay); nextDelay += 0.22; sfxLater(born.get(key));
  };
  // 첫 두 장씩은 플레이어, 딜러 순으로 번갈아 놓이도록 순서를 정해서 확인한다
  const order = [];
  const maxLen = Math.max(st.dealer.length, ...st.hands.map((h) => h.cards.length), 0);
  for (let i = 0; i < maxLen; i++) {
    st.hands.forEach((h, hi) => { if (i < h.cards.length) order.push(`h${hi}:${i}`); });
    if (i < st.dealer.length) order.push(`d:${i}`);
  }
  order.forEach(check);
}
function sfxLater(t) { setTimeout(sfx.card, Math.max(0, (t - uiT) * 1000)); }
const landed = (key) => (born.has(key) ? ease((uiT - born.get(key)) / 0.28) : 0);
const allLanded = () => [...born.values()].every((t) => uiT - t >= 0.28);

function drawTable(dt) {
  buttons.length = 0;
  // 배경: 초록 천
  const g = ctx.createRadialGradient(W / 2, 260, 40, W / 2, 260, 420);
  g.addColorStop(0, '#2fae6b'); g.addColorStop(1, '#14724a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(W / 2, 250, 150, 70, 0, 0, 7); ctx.stroke();

  if (st.phase !== 'bet') stampBorn();

  // 슈 (카드가 나오는 곳)
  for (let i = 0; i < 3; i++) drawCard(W - 74 + i * 2, 10 - i, 0, false, 1, false);

  // 딜러
  ctx.fillStyle = '#fff'; ctx.font = '15px Jua, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('딜러', 14, 24);
  const dpos = cardPos(st.dealer, 150, 36, 40);
  const holeVisible = !st.hole && uiT >= revealAt && revealAt > 0;
  if (!st.hole && !revealAt && st.phase !== 'bet') revealAt = Math.max(uiT, ...[...born.values()].map((t) => t + 0.35)) + 0.35;
  st.dealer.forEach((c, i) => {
    const lt = landed('d:' + i), p = dpos[i];
    if (lt <= 0) return;
    const x = p.x + (W - 74 - p.x) * (1 - lt), y = p.y + (10 - p.y) * (1 - lt);
    if (i === 1) {
      // 뒤집힌 카드: 공개 시각에 휙 뒤집힌다
      const f = holeVisible ? Math.min(1, (uiT - revealAt) / 0.25) : 0;
      if (f <= 0) drawCard(x, y, c, false);
      else if (f < 0.5) drawCard(x, y, c, false, 1 - f * 2);
      else drawCard(x, y, c, true, (f - 0.5) * 2);
    } else drawCard(x, y, c, true);
  });
  if (st.dealer.length && allLanded()) {
    const shown = (st.hole || !holeVisible) ? [st.dealer[0]] : st.dealer;
    const hv = L.handValue(shown);
    banner(String(hv.total), dpos[dpos.length - 1].x + CW + 26, 76, hv.total > 21 ? '#ff5f7a' : '#4a3a86');
  }

  // 플레이어 손
  const nH = st.hands.length;
  st.hands.forEach((h, hi) => {
    const cx = nH === 1 ? W / 2 : (hi === 0 ? 95 : 265), y = 168;
    const pos = cardPos(h.cards, cx, y, nH === 1 ? 40 : 26);
    const active = st.phase === 'player' && hi === st.active;
    const dim = nH > 1 && st.phase === 'player' && !active;
    h.cards.forEach((c, i) => {
      const lt = landed(`h${hi}:${i}`), p = pos[i];
      if (lt <= 0) return;
      drawCard(p.x + (W - 74 - p.x) * (1 - lt), p.y + (10 - p.y) * (1 - lt), c, true, 1, dim);
    });
    const ready = h.cards.every((_, i) => uiT - (born.get(`h${hi}:${i}`) ?? 1e9) >= 0.28);
    if (ready && h.cards.length) {
      const v = L.handValue(h.cards);
      const label = v.total > 21 ? `${v.total} 버스트` : (L.isNatural(h) ? '블랙잭!' : (v.soft && v.total < 21 ? `${v.total - 10}/${v.total}` : String(v.total)));
      banner(label, cx, y + CH + 20, v.total > 21 ? '#ff5f7a' : (active ? '#ffa42b' : '#4a3a86'));
      if (active) { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(cx - 8, y - 12); ctx.lineTo(cx + 8, y - 12); ctx.lineTo(cx, y - 2); ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.stroke(); }
    }
    // 이 손에 건 칩
    if (h.bet) { drawBetStack(nH === 1 ? 62 : cx - 30, 346, h.bet); ctx.fillStyle = '#fff'; ctx.font = '13px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(fmt(h.bet), nH === 1 ? 62 : cx - 30, 380); }
    // 결과
    if (st.phase === 'settle' && settledShownAt && uiT >= settledShownAt && h.result) {
      const R = { win: ['승리', '#4cd964'], blackjack: ['블랙잭!', '#ffa42b'], push: ['무승부', '#6b5c95'], lose: ['패배', '#ff5f7a'], bust: ['버스트', '#ff5f7a'] }[h.result];
      const net = h.payout - h.bet;
      banner(`${R[0]} ${net > 0 ? '+' + fmt(net) : net < 0 ? fmt(net) : ''}`.trim(), cx, y + CH + 54, R[1]);
    }
  });
  if (!nH) {
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '16px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('칩을 눌러 판돈을 걸어요', W / 2, 200);
  }

  // 하단 패널
  if (st.phase === 'bet') {
    // 판돈
    ctx.fillStyle = '#fff'; ctx.font = '16px Jua, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(st.bet ? `판돈 ${fmt(st.bet)}` : `판돈을 걸어 주세요 (${L.MIN_BET}~${fmt(L.maxBet(st))})`, W / 2, 322);
    if (st.bet) drawBetStack(W / 2, 372, st.bet);
    L.CHIP_VALUES.forEach((v, i) => {
      const x = 44 + i * 68, y = 448, can = st.bet + v <= L.maxBet(st);
      ctx.globalAlpha = can ? 1 : 0.35; drawChip(x, y, v, 27); ctx.globalAlpha = 1;
      buttons.push({ x: x - 30, y: y - 30, w: 60, h: 60, enabled: true, on: () => addChip(v) });
    });
    button('clear', '비우기', 12, 492, 96, 50, st.bet > 0, '#fff', () => { L.clearBet(st); sfx.chip(); });
    button('again', '같은 금액', 118, 492, 110, 50, st.lastBet >= L.MIN_BET && st.lastBet <= st.chips, '#c7e8ff', () => { if (L.repeatBet(st)) sfx.chip(); });
    button('deal', '딜!', 238, 492, 110, 50, L.canDeal(st), '#ffd23f', doDeal);
  } else if (st.phase === 'player') {
    const bw = 80, gap = 8, x0 = (W - (bw * 4 + gap * 3)) / 2, y = 440;
    button('hit', '히트', x0, y, bw, 60, L.canHit(st), '#4cd964', () => act(L.hit), '한 장 더');
    button('stand', '스탠드', x0 + (bw + gap), y, bw, 60, true, '#ff7ab6', () => act(L.stand), '멈춤');
    button('dbl', '더블', x0 + (bw + gap) * 2, y, bw, 60, L.canDouble(st), '#ffd23f', () => act(L.double), '2배+한 장');
    button('split', '스플릿', x0 + (bw + gap) * 3, y, bw, 60, L.canSplit(st), '#c7e8ff', () => act(L.split), '두 손으로');
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '13px Jua, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`남은 칩 ${fmt(st.chips)}`, W / 2, 530);
  } else if (st.phase === 'dealer') {
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '18px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('딜러 차례…', W / 2, 470);
  } else if (st.phase === 'settle') {
    const ready = settledShownAt && uiT >= settledShownAt;
    if (ready) {
      const net = st.hands.reduce((a, h) => a + h.payout - h.bet, 0);
      ctx.fillStyle = '#fff'; ctx.font = '22px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
      const msg = net > 0 ? `+${fmt(net)} 칩 획득!` : net < 0 ? `${fmt(net)} 칩` : '본전이에요';
      ctx.strokeText(msg, W / 2, 440); ctx.fillStyle = net > 0 ? '#ffd23f' : net < 0 ? '#ffb3c0' : '#fff'; ctx.fillText(msg, W / 2, 440);
      button('next', '다음 판', 90, 458, 180, 58, true, '#ffd23f', doNext, 'Enter');
    }
  }

  // 알림
  if (toast && uiT < toast.until) banner(toast.text, W / 2, 140, '#4a3a86');
  // 떠오르는 글자
  ctx.font = '22px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = INK;
  for (const f of floats) { f.t += dt; ctx.globalAlpha = Math.max(0, 1 - f.t / 1.1); const y = f.y - f.t * 40; ctx.strokeText(f.text, f.x, y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y); }
  ctx.globalAlpha = 1; floats = floats.filter((f) => f.t < 1.1);
  if (flash > 0) { ctx.fillStyle = `rgba(255,236,150,${flash})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 2); }
}

// ---------- 루프 ----------
let last = 0, lastPhase = 'bet';
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; uiT += dt;
  if (mode === 'table' || mode === 'menu') {
    if (st.phase !== 'bet') stampBorn();                  // 새 카드의 날아오는 시각 (정산 시점 계산보다 먼저)
    // 딜러 차례: 카드가 다 놓인 뒤 한 장씩
    if (st.phase === 'dealer' && allLanded()) {
      if (!dealerTimer) dealerTimer = uiT + 0.7;
      if (uiT >= dealerTimer) { L.dealerStep(st); dealerTimer = uiT + 0.7; if (st.phase !== 'dealer') dealerTimer = 0; }
    }
    // 정산이 화면에 보이는 시점 (카드·뒤집기 연출이 끝난 뒤)
    if (st.phase === 'settle' && !settledShownAt) {
      const rv = revealAt || (revealAt = Math.max(uiT, ...[...born.values()].map((t) => t + 0.35)) + 0.35);
      settledShownAt = Math.max(rv + 0.5, ...[...born.values()].map((t) => t + 0.6));
    }
    if (st.phase === 'settle' && settledShownAt && uiT >= settledShownAt && lastPhase !== 'shown') {
      lastPhase = 'shown';
      const net = st.hands.reduce((a, h) => a + h.payout - h.bet, 0);
      const bj = st.hands.some((h) => h.result === 'blackjack');
      if (bj) { sfx.bj(); flash = 0.4; } else if (net > 0) { sfx.win(); flash = 0.2; } else if (net === 0) sfx.push(); else sfx.lose();
      save(); shownChips = st.chips; updateHud();
      if (net !== 0) floatText(W / 2, 300, net > 0 ? `+${fmt(net)}` : fmt(net), net > 0 ? '#ffd23f' : '#ffb3c0');
    }
    if (st.phase !== 'settle') lastPhase = st.phase;
  }
  if (mode === 'title') {
    // 타이틀 뒤: 빈 초록 테이블
    const keep = st; st = EMPTY; drawTable(dt); st = keep;
  } else drawTable(dt);
  requestAnimationFrame(frame);
}

updateHud();
showTitle();
fit();
requestAnimationFrame(frame);
