export function splitEqually(amountPaise, memberUids) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || memberUids.length === 0) throw new Error('Invalid equal split input.');
  const each = Math.floor(amountPaise / memberUids.length);
  const remainder = amountPaise % memberUids.length;
  return memberUids.map((uid, index) => ({ uid, amountPaise: each + (index < remainder ? 1 : 0) }));
}

export function validateCustomSplit(amountPaise, memberUids, supplied) {
  if (!Array.isArray(supplied) || supplied.length !== memberUids.length) throw new Error('Enter a share amount for every active member.');
  const seen = new Set();
  const shares = supplied.map((item) => {
    const uid = String(item?.uid ?? '');
    const amount = Number(item?.amountPaise);
    if (!memberUids.includes(uid) || seen.has(uid) || !Number.isSafeInteger(amount) || amount < 0) throw new Error('Custom shares contain an invalid member or amount.');
    seen.add(uid);
    return { uid, amountPaise: amount };
  });
  if (seen.size !== memberUids.length || shares.reduce((sum, share) => sum + share.amountPaise, 0) !== amountPaise) throw new Error('Custom shares must add up exactly to the expense total.');
  return shares;
}

export function calculateSettlementTransfers(expenses, settlements = []) {
  const net = new Map();
  for (const expense of expenses) {
    const amount = Number(expense.amountPaise);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !expense.paidBy) continue;
    net.set(expense.paidBy, (net.get(expense.paidBy) ?? 0) + amount);
    for (const share of expense.shares ?? []) {
      if (typeof share.uid !== 'string' || !Number.isSafeInteger(share.amountPaise) || share.amountPaise < 0) continue;
      net.set(share.uid, (net.get(share.uid) ?? 0) - share.amountPaise);
    }
  }
  for (const settlement of settlements) {
    if (!Number.isSafeInteger(settlement.amountPaise) || settlement.amountPaise <= 0 || !settlement.fromUid || !settlement.toUid) continue;
    net.set(settlement.fromUid, (net.get(settlement.fromUid) ?? 0) + settlement.amountPaise);
    net.set(settlement.toUid, (net.get(settlement.toUid) ?? 0) - settlement.amountPaise);
  }
  const creditors = [...net.entries()].filter(([, value]) => value > 0).map(([uid, amount]) => ({ uid, amount })).sort((a, b) => b.amount - a.amount);
  const debtors = [...net.entries()].filter(([, value]) => value < 0).map(([uid, amount]) => ({ uid, amount: -value })).sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0) transfers.push({ fromUid: debtors[i].uid, toUid: creditors[j].uid, amountPaise: amount });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }
  return transfers;
}
