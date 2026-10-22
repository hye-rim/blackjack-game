'use strict';
// 블랙잭 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// 카드 번호: 무늬 0 의 A=0, 2~10 = 1~9, J=10, Q=11, K=12
const A = 0, J = 10, Q = 11, K = 12, n = (v) => v - 1;
// 앞으로 나올 카드를 순서대로 정한다 (draw 는 슈의 맨 뒤에서 꺼낸다). 앞쪽은 다시 섞이지 않을 만큼 채운다
function rig(st, cards) { st.shoe = [...new Array(100).fill(n(2)), ...cards.slice().reverse()]; }
// 판돈 bet 으로 시작: 플레이어 p1, 딜러 d1, 플레이어 p2, 딜러 d2, 그다음 rest
function start(cards, bet = 100, chips = 1000) {
  const st = L.newGame(chips, 1);
  rig(st, cards);
  assert.ok(L.addBet(st, bet));
  assert.ok(L.deal(st));
  return st;
}
const playDealer = (st) => { let k = 0; while (!L.dealerStep(st)) assert.ok(++k < 20); };

test('hand values: aces count 11 until that would bust', () => {
  const hv = (...c) => L.handValue(c);
  assert.deepStrictEqual(hv(A, K), { total: 21, soft: true });
  assert.deepStrictEqual(hv(A, A), { total: 12, soft: true });
  assert.deepStrictEqual(hv(A, A, K), { total: 12, soft: false });
  assert.deepStrictEqual(hv(A, n(6)), { total: 17, soft: true });
  assert.deepStrictEqual(hv(K, Q, n(2)), { total: 22, soft: false });
  assert.deepStrictEqual(hv(A, A, A, A, n(7)), { total: 21, soft: true });
  assert.strictEqual(L.valueOf(J), 10);
  assert.strictEqual(L.valueOf(n(10)), 10);
});

test('betting limits', () => {
  const st = L.newGame(30, 1);
  assert.ok(!L.canDeal(st));
  assert.ok(L.addBet(st, 25));
  assert.ok(!L.addBet(st, 10), 'cannot bet more than you have');
  assert.ok(L.addBet(st, 5));
  assert.ok(L.canDeal(st));
  L.clearBet(st);
  assert.strictEqual(st.bet, 0);
  assert.ok(L.addBet(st, 5) && !L.canDeal(st) === false);
  const broke = L.newGame(4, 1);
  assert.ok(L.isBroke(broke));
});

test('player blackjack pays 3:2 straight away; both blackjack is a push', () => {
  let st = start([A, n(9), K, n(7)]);
  assert.strictEqual(st.phase, 'settle');
  assert.strictEqual(st.hands[0].result, 'blackjack');
  assert.strictEqual(st.chips, 1000 + 150);
  st = start([A, n(9), K, n(7)], 5);                  // 5칩의 3:2 는 7.5 → 반 칩은 버려서 +7
  assert.strictEqual(st.hands[0].payout, 12);
  assert.strictEqual(st.chips, 1000 + 7);
  st = start([A, A, K, Q]);
  assert.strictEqual(st.hands[0].result, 'push');
  assert.strictEqual(st.chips, 1000);
});

test('dealer blackjack wins at once against 21 made of three cards too', () => {
  const st = start([n(9), A, n(8), K]);
  assert.strictEqual(st.phase, 'settle');
  assert.strictEqual(st.hands[0].result, 'lose');
  assert.strictEqual(st.chips, 900);
});

test('dealer draws to 17 and stands on soft 17', () => {
  let st = start([K, A, n(7), n(6)]);                 // 딜러 A+6 = 소프트 17
  assert.ok(L.stand(st));
  playDealer(st);
  assert.strictEqual(st.dealer.length, 2);
  assert.strictEqual(st.hands[0].result, 'push');
  st = start([K, n(5), n(9), n(6), n(4), n(10)]);     // 딜러 5+6=11 → +4 = 15 → +10 = 25 버스트
  L.stand(st);
  playDealer(st);
  assert.strictEqual(L.handValue(st.dealer).total, 25);
  assert.strictEqual(st.hands[0].result, 'win');
  assert.strictEqual(st.chips, 1100);
});

test('hitting to 21 ends the hand; busting loses without the dealer drawing', () => {
  let st = start([n(5), K, n(6), n(7), K]);           // 5+6, 딜러 K+7 → 히트 K = 21
  L.hit(st);
  assert.strictEqual(st.phase, 'dealer');
  playDealer(st);
  assert.strictEqual(st.hands[0].result, 'win');
  st = start([K, n(9), n(6), n(7), K]);               // 16 에 히트 K → 26
  L.hit(st);
  assert.strictEqual(st.phase, 'settle');
  assert.strictEqual(st.hands[0].result, 'bust');
  assert.strictEqual(st.dealer.length, 2, 'dealer does not draw when everyone busted');
  assert.strictEqual(st.chips, 900);
});

test('double: twice the bet, exactly one more card', () => {
  const st = start([n(5), n(9), n(6), n(7), K]);      // 11 에 더블 → 21
  assert.ok(L.canDouble(st));
  L.double(st);
  assert.strictEqual(st.hands[0].bet, 200);
  assert.strictEqual(st.hands[0].cards.length, 3);
  assert.strictEqual(st.phase, 'dealer');
  playDealer(st);
  assert.strictEqual(st.chips, 1000 + 200);
  const poor = start([n(5), n(9), n(6), n(7)], 100, 150);
  assert.ok(!L.canDouble(poor), 'not enough chips to double');
});

test('split: two hands, 21 after a split is not blackjack, split aces get one card each', () => {
  let st = start([n(8), n(9), n(8), n(7), A, K, n(10)]);   // 8,8 스플릿 → 8+A, 8+K. 딜러 16 → +10 버스트
  assert.ok(L.canSplit(st));
  L.split(st);
  assert.strictEqual(st.hands.length, 2);
  assert.strictEqual(st.chips, 800);
  L.stand(st); L.stand(st);
  playDealer(st);
  assert.deepStrictEqual(st.hands.map((h) => h.result), ['win', 'win']);
  assert.strictEqual(st.chips, 800 + 400);
  assert.ok(!L.canSplit(st));

  st = start([A, n(9), A, n(7), K, n(5)]);            // A,A 스플릿 → A+K(21), A+5. 둘 다 끝
  L.split(st);
  assert.ok(st.hands.every((h) => h.done));
  assert.strictEqual(st.phase, 'dealer');
  playDealer(st);
  assert.strictEqual(st.hands[0].result, 'win', '21 after split pays 1:1, not 3:2');
  assert.strictEqual(st.hands[0].payout, 200);

  st = start([K, n(9), Q, n(7)]);                     // 10 끼리도 스플릿
  assert.ok(L.canSplit(st));
});

test('a long random session keeps chips consistent and never negative', () => {
  const st = L.newGame(1000, 99);
  let rounds = 0, r = 7;
  const rand = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;
  while (rounds < 3000 && !L.isBroke(st)) {
    const before = st.chips;
    const bet = Math.min(L.maxBet(st), [5, 10, 25, 100][Math.floor(rand() * 4)]);
    assert.ok(L.addBet(st, bet));
    assert.ok(L.deal(st));
    while (st.phase === 'player') {
      const x = rand();
      if (x < 0.1 && L.canSplit(st)) L.split(st);
      else if (x < 0.2 && L.canDouble(st)) L.double(st);
      else if (x < 0.55 && L.canHit(st)) L.hit(st);
      else L.stand(st);
    }
    playDealer(st);
    assert.strictEqual(st.phase, 'settle');
    const staked = st.hands.reduce((s, h) => s + h.bet, 0);
    assert.strictEqual(st.chips, before + st.net, 'chips change by exactly the net result');
    assert.strictEqual(st.net, st.hands.reduce((s, h) => s + h.payout, 0) - staked);
    assert.ok(st.chips >= 0);
    assert.ok(Number.isInteger(st.chips), 'chips are always whole numbers');
    L.nextRound(st);
    rounds++;
  }
  assert.strictEqual(st.rounds, rounds);
  assert.ok(st.wins + st.losses + st.pushes >= rounds, 'every hand (split hands too) gets a result');
  assert.ok(rounds > 50);
});
