import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
initializeApp();
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });
const db = getFirestore();
const requireUid = (uid?: string) => { if (!uid) throw new HttpsError('unauthenticated', 'Please sign in first.'); return uid; };
export const createGroup = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const name = String(request.data?.name ?? '').trim();
  if (name.length < 2 || name.length > 60) throw new HttpsError('invalid-argument', 'Group name must be 2–60 characters.');
  const group = db.collection('groups').doc();
  await db.runTransaction(async tx => {
    tx.create(group, { name, currency: 'INR', createdBy: uid, memberUids: [uid], status: 'active', createdAt: FieldValue.serverTimestamp() });
    tx.create(group.collection('members').doc(uid), { uid, role: 'admin', joinedAt: FieldValue.serverTimestamp(), status: 'active' });
    tx.create(group.collection('vault').doc('summary'), { balancePaise: 0, updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.collection('users').doc(uid).collection('groupMemberships').doc(group.id), { groupId: group.id, role: 'admin', joinedAt: FieldValue.serverTimestamp() });
  });
  return { groupId: group.id };
});
export const recordExpense = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const description = String(request.data?.description ?? '').trim();
  const amountPaise = Number(request.data?.amountPaise);
  if (!groupId || description.length < 2 || description.length > 120) throw new HttpsError('invalid-argument', 'A group and valid description are required.');
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 100000000000) throw new HttpsError('invalid-argument', 'Enter a valid positive amount.');
  const groupRef = db.collection('groups').doc(groupId);
  const expenseRef = groupRef.collection('expenses').doc();
  await db.runTransaction(async tx => {
    const groupSnap = await tx.get(groupRef);
    if (!groupSnap.exists || !(groupSnap.data()?.memberUids ?? []).includes(uid)) throw new HttpsError('permission-denied', 'You are not a member of this group.');
    const members: string[] = groupSnap.data()?.memberUids ?? [uid];
    const each = Math.floor(amountPaise / members.length), remainder = amountPaise % members.length;
    const shares = members.map((memberUid, index) => ({ uid: memberUid, amountPaise: each + (index < remainder ? 1 : 0) }));
    tx.create(expenseRef, { description, amountPaise, currency: 'INR', category: 'General', paidBy: uid, splitType: 'equal', shares, createdBy: uid, createdAt: FieldValue.serverTimestamp(), status: 'recorded' });
    tx.create(groupRef.collection('ledger').doc(), { type: 'expense_recorded', referenceId: expenseRef.id, amountPaise, actorUid: uid, description, createdAt: FieldValue.serverTimestamp(), status: 'recorded' });
  });
  return { expenseId: expenseRef.id };
});
export const health = onCall(async request => { requireUid(request.auth?.uid); return { ok: true, region: 'asia-south1' }; });
