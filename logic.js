'use strict';

// 블랙잭: 규칙만 모아 둔 파일 (그리기·입력 없음). 브라우저와 테스트(Node)가 같이 쓴다. 칩은 게임용 칩이다.
//
// - 6덱 슈. 21에 가깝게 만들되 넘으면(버스트) 진다. 딜러는 17 이상이면 멈춘다(소프트 17도 멈춤)
// - 처음 두 장이 A+10(블랙잭)이면 배당 3:2. 이기면 건 만큼, 비기면 돌려받고, 지면 잃는다
// - 히트(한 장 더) · 스탠드(멈춤) · 더블(처음 두 장일 때 판돈을 두 배로 걸고 딱 한 장만 받음) · 스플릿(같은 숫자 두 장을 두 손으로 나눔, 한 번만)
// - 스플릿한 에이스는 한 장씩만 받고, 스플릿 뒤의 21은 블랙잭으로 치지 않는다
const LOGIC_BJ = (() => {
const START_CHIPS = 1000, MIN_BET = 5, MAX_BET = 1000, DECKS = 6, RESHUFFLE_AT = 78;
const CHIP_VALUES = [5, 10, 25, 100, 500];

function rng(seed) {                                     // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 카드: 0~51. rank = c % 13 (0 = A, 1~9 = 2~10, 10 J, 11 Q, 12 K), suit = floor(c / 13)
const rankOf = (c) => c % 13, suitOf = (c) => Math.floor(c / 13);
const valueOf = (c) => { const r = rankOf(c); return r === 0 ? 11 : Math.min(10, r + 1); };

function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += valueOf(c); if (rankOf(c) === 0) aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };                      // soft: 에이스를 11로 세고 있는 손
}
const isBust = (cards) => handValue(cards).total > 21;
const isNatural = (h) => !h.fromSplit && h.cards.length === 2 && handValue(h.cards).total === 21;

function newShoe(rand) {
  const a = [];
  for (let d = 0; d < DECKS; d++) for (let c = 0; c < 52; c++) a.push(c);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function newGame(chips = START_CHIPS, seed = (Math.random() * 2 ** 31) | 0) {
  const rand = rng(seed);
  return {
    rand, seed, chips, bet: 0, lastBet: 0, shoe: newShoe(rand), shuffled: false, phase: 'bet',
    dealer: [], hole: true, hands: [], active: 0, events: [], results: [],
    rounds: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, bestChips: chips,
  };
}

function draw(st) {
  if (!st.shoe.length) st.shoe = newShoe(st.rand);
  return st.shoe.pop();
}

// ---- 판돈 ----
const maxBet = (st) => Math.min(MAX_BET, st.chips);
function addBet(st, v) {
  if (st.phase !== 'bet') return false;
  if (st.bet + v > maxBet(st)) return false;
  st.bet += v; return true;
}
function clearBet(st) { if (st.phase === 'bet') st.bet = 0; }
function repeatBet(st) { if (st.phase !== 'bet' || !st.lastBet) return false; st.bet = Math.min(st.lastBet, maxBet(st)); return st.bet >= MIN_BET; }
const canDeal = (st) => st.phase === 'bet' && st.bet >= MIN_BET && st.bet <= st.chips;
const isBroke = (st) => st.phase === 'bet' && st.chips < MIN_BET;

// ---- 한 판 시작 ----
function deal(st) {
  if (!canDeal(st)) return false;
  st.shuffled = false;
  if (st.shoe.length < RESHUFFLE_AT) { st.shoe = newShoe(st.rand); st.shuffled = true; }
  st.chips -= st.bet; st.lastBet = st.bet;
  st.hands = [{ cards: [], bet: st.bet, done: false, doubled: false, fromSplit: false, result: null, payout: 0 }];
  st.dealer = []; st.hole = true; st.active = 0; st.results = []; st.events = [];
  // 플레이어, 딜러, 플레이어, 딜러(뒤집힌 카드) 순서
  st.hands[0].cards.push(draw(st)); st.dealer.push(draw(st)); st.hands[0].cards.push(draw(st)); st.dealer.push(draw(st));
  st.phase = 'player';
  const pBJ = isNatural(st.hands[0]), dBJ = handValue(st.dealer).total === 21;
  if (pBJ || dBJ) { st.hands[0].done = true; finishRound(st); }        // 블랙잭이 나오면 바로 끝
  return true;
}

const cur = (st) => st.hands[st.active];
const canHit = (st) => st.phase === 'player' && !cur(st).done && !(cur(st).fromSplit && rankOf(cur(st).cards[0]) === 0 && cur(st).cards.length >= 2);
const canDouble = (st) => st.phase === 'player' && !cur(st).done && cur(st).cards.length === 2 && st.chips >= cur(st).bet && !(cur(st).fromSplit && rankOf(cur(st).cards[0]) === 0);
const canSplit = (st) => {
  if (st.phase !== 'player' || st.hands.length !== 1) return false;
  const h = cur(st);
  return !h.done && h.cards.length === 2 && valueOf(h.cards[0]) === valueOf(h.cards[1]) && st.chips >= h.bet;   // 10, J, Q, K 끼리도 가능
};

function nextHand(st) {
  while (st.active < st.hands.length && st.hands[st.active].done) st.active++;
  if (st.active >= st.hands.length) { st.active = st.hands.length - 1; startDealer(st); }
}
function startDealer(st) {
  st.phase = 'dealer'; st.hole = false;
  // 모든 손이 버스트면 딜러는 더 뽑지 않는다
  if (st.hands.every((h) => isBust(h.cards))) finishRound(st);
}

function hit(st) {
  if (!canHit(st)) return false;
  const h = cur(st);
  h.cards.push(draw(st));
  const v = handValue(h.cards).total;
  if (v >= 21) h.done = true;
  if (h.done) nextHand(st);
  return true;
}
function stand(st) {
  if (st.phase !== 'player' || cur(st).done) return false;
  cur(st).done = true; nextHand(st); return true;
}
function double(st) {
  if (!canDouble(st)) return false;
  const h = cur(st);
  st.chips -= h.bet; h.bet *= 2; h.doubled = true;
  h.cards.push(draw(st)); h.done = true;
  nextHand(st); return true;
}
function split(st) {
  if (!canSplit(st)) return false;
  const h = cur(st), [a, b] = h.cards;
  st.chips -= h.bet;
  const aces = rankOf(a) === 0;
  h.cards = [a, draw(st)]; h.fromSplit = true;
  const h2 = { cards: [b, draw(st)], bet: h.bet, done: false, doubled: false, fromSplit: true, result: null, payout: 0 };
  st.hands.push(h2);
  if (aces) { h.done = true; h2.done = true; }                     // 에이스 스플릿은 한 장씩만
  else { if (handValue(h.cards).total === 21) h.done = true; if (handValue(h2.cards).total === 21) h2.done = true; }
  st.active = 0; nextHand(st); return true;
}

// 딜러 차례: 한 장씩 (화면이 천천히 보여 줄 수 있게). 끝나면 true
function dealerStep(st) {
  if (st.phase !== 'dealer') return true;
  const v = handValue(st.dealer).total;
  if (v < 17) { st.dealer.push(draw(st)); return false; }
  finishRound(st);
  return true;
}

function finishRound(st) {
  st.hole = false;
  const d = handValue(st.dealer).total, dBJ = st.dealer.length === 2 && d === 21;
  let net = 0;
  st.hands.forEach((h) => {
    const v = handValue(h.cards).total, nat = isNatural(h);
    let r, pay;
    if (v > 21) { r = 'bust'; pay = 0; }
    else if (nat && !dBJ) { r = 'blackjack'; pay = h.bet * 2.5; }
    else if (dBJ && !nat) { r = 'lose'; pay = 0; }
    else if (nat && dBJ) { r = 'push'; pay = h.bet; }
    else if (d > 21 || v > d) { r = 'win'; pay = h.bet * 2; }
    else if (v === d) { r = 'push'; pay = h.bet; }
    else { r = 'lose'; pay = 0; }
    h.result = r; h.payout = pay; st.chips += pay; net += pay - h.bet;
    if (r === 'win' || r === 'blackjack') st.wins++; else if (r === 'push') st.pushes++; else st.losses++;
    if (r === 'blackjack') st.blackjacks++;
  });
  st.rounds++; st.net = net; st.phase = 'settle'; st.bestChips = Math.max(st.bestChips, st.chips);
  st.events.push('end');
}
// 다음 판 준비
function nextRound(st) {
  if (st.phase !== 'settle') return false;
  st.phase = 'bet'; st.bet = 0; st.hands = []; st.dealer = []; st.hole = true; st.active = 0;
  return true;
}

const LOGIC = { START_CHIPS, MIN_BET, MAX_BET, CHIP_VALUES, rankOf, suitOf, valueOf, handValue, isBust, isNatural, newGame, addBet, clearBet, repeatBet, canDeal, isBroke, maxBet, deal, canHit, canDouble, canSplit, hit, stand, double, split, dealerStep, nextRound };
return LOGIC;
})();
if (typeof module !== 'undefined') module.exports = LOGIC_BJ;
