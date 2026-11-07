import test from 'node:test';
import assert from 'node:assert/strict';
import domain from '../lib/domain.js';

const { splitEqually, validateCustomSplit, calculateSettlementTransfers } = domain;

test('equal split allocates every paise deterministically', () => {
  assert.deepEqual(splitEqually(100, ['a', 'b', 'c']), [
    { uid: 'a', amountPaise: 34 },
    { uid: 'b', amountPaise: 33 },
    { uid: 'c', amountPaise: 33 }
  ]);
});

test('equal split preserves total for a single member', () => {
  assert.deepEqual(splitEqually(725, ['a']), [{ uid: 'a', amountPaise: 725 }]);
});

test('custom split accepts exact member shares', () => {
  assert.deepEqual(validateCustomSplit(1000, ['a', 'b'], [
    { uid: 'a', amountPaise: 250 },
    { uid: 'b', amountPaise: 750 }
  ]), [
    { uid: 'a', amountPaise: 250 },
    { uid: 'b', amountPaise: 750 }
  ]);
});

test('custom split rejects duplicate members and mismatched totals', () => {
  assert.throws(() => validateCustomSplit(100, ['a', 'b'], [
    { uid: 'a', amountPaise: 50 },
    { uid: 'a', amountPaise: 50 }
  ]));
  assert.throws(() => validateCustomSplit(100, ['a', 'b'], [
    { uid: 'a', amountPaise: 40 },
    { uid: 'b', amountPaise: 50 }
  ]));
});

test('settlement suggestions balance payers and shares', () => {
  const transfers = calculateSettlementTransfers([{
    amountPaise: 300,
    paidBy: 'a',
    shares: [
      { uid: 'a', amountPaise: 100 },
      { uid: 'b', amountPaise: 100 },
      { uid: 'c', amountPaise: 100 }
    ]
  }]);
  assert.deepEqual(transfers, [
    { fromUid: 'b', toUid: 'a', amountPaise: 100 },
    { fromUid: 'c', toUid: 'a', amountPaise: 100 }
  ]);
});

test('settlement suggestions return no transfers when all shares are settled', () => {
  assert.deepEqual(calculateSettlementTransfers([{
    amountPaise: 200,
    paidBy: 'a',
    shares: [{ uid: 'a', amountPaise: 200 }]
  }]), []);
});

test('mutually confirmed settlements reduce outstanding balances', () => {
  const expenses = [{
    amountPaise: 300,
    paidBy: 'a',
    shares: [
      { uid: 'a', amountPaise: 100 },
      { uid: 'b', amountPaise: 100 },
      { uid: 'c', amountPaise: 100 }
    ]
  }];
  assert.deepEqual(calculateSettlementTransfers(expenses, [
    { fromUid: 'b', toUid: 'a', amountPaise: 100 }
  ]), [
    { fromUid: 'c', toUid: 'a', amountPaise: 100 }
  ]);
});
