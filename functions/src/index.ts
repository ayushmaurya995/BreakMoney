import { createHash, randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
initializeApp();
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });
const db = getFirestore();
const requireUid = (uid?: string) => { if (!uid) throw new HttpsError('unauthenticated', 'Please sign in first.'); return uid; };
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const validAmount = (amount: unknown): number => {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100000000000) throw new HttpsError('invalid-argument', 'Enter a valid positive amount in paise.');
  return value;
};
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
  const amountPaise = validAmount(request.data?.amountPaise);
  if (!groupId || description.length < 2 || description.length > 120) throw new HttpsError('invalid-argument', 'A group and valid description are required.');
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
export const createInvite = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const expiresInDays = Math.min(30, Math.max(1, Number(request.data?.expiresInDays ?? 7)));
  if (!groupId || !Number.isInteger(expiresInDays)) throw new HttpsError('invalid-argument', 'Invalid invite request.');
  const groupRef = db.collection('groups').doc(groupId);
  const token = randomBytes(24).toString('base64url');
  const inviteRef = db.collection('groupInvites').doc(tokenHash(token));
  await db.runTransaction(async tx => {
    const [groupSnap, memberSnap] = await Promise.all([tx.get(groupRef), tx.get(groupRef.collection('members').doc(uid))]);
    if (!groupSnap.exists || !memberSnap.exists || memberSnap.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Only group admins can invite members.');
    tx.create(inviteRef, { groupId, createdBy: uid, createdAt: FieldValue.serverTimestamp(), expiresAt: new Date(Date.now() + expiresInDays * 86400000), status: 'active', uses: 0, maxUses: 50 });
  });
  return { token, expiresInDays };
});
export const joinGroup = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const token = String(request.data?.token ?? '');
  if (token.length < 20 || token.length > 100) throw new HttpsError('invalid-argument', 'Invalid invite link.');
  const inviteRef = db.collection('groupInvites').doc(tokenHash(token));
  await db.runTransaction(async tx => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) throw new HttpsError('not-found', 'This invite is invalid or expired.');
    const invite = inviteSnap.data()!;
    const expiresAt = invite.expiresAt?.toDate?.() ?? invite.expiresAt;
    if (invite.status !== 'active' || !expiresAt || new Date(expiresAt).getTime() < Date.now() || invite.uses >= invite.maxUses) throw new HttpsError('failed-precondition', 'This invite has expired or reached its usage limit.');
    const groupRef = db.collection('groups').doc(invite.groupId);
    const memberRef = groupRef.collection('members').doc(uid);
    const membershipRef = db.collection('users').doc(uid).collection('groupMemberships').doc(invite.groupId);
    const [groupSnap, memberSnap] = await Promise.all([tx.get(groupRef), tx.get(memberRef)]);
    if (!groupSnap.exists || groupSnap.data()?.status !== 'active') throw new HttpsError('not-found', 'This group is no longer active.');
    if (memberSnap.exists) return;
    const members: string[] = groupSnap.data()?.memberUids ?? [];
    if (members.length >= 100) throw new HttpsError('resource-exhausted', 'This group has reached its member limit.');
    tx.create(memberRef, { uid, role: 'member', joinedAt: FieldValue.serverTimestamp(), status: 'active' });
    tx.set(membershipRef, { groupId: invite.groupId, role: 'member', joinedAt: FieldValue.serverTimestamp() });
    tx.update(groupRef, { memberUids: [...members, uid], updatedAt: FieldValue.serverTimestamp() });
    tx.update(inviteRef, { uses: FieldValue.increment(1) });
  });
  return { joined: true };
});
export const recordManualContribution = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const description = String(request.data?.description ?? 'Manual cash contribution').trim().slice(0, 120);
  const amountPaise = validAmount(request.data?.amountPaise);
  if (!groupId) throw new HttpsError('invalid-argument', 'Group is required.');
  const groupRef = db.collection('groups').doc(groupId);
  const vaultRef = groupRef.collection('vault').doc('summary');
  const ledgerRef = groupRef.collection('ledger').doc();
  await db.runTransaction(async tx => {
    const [groupSnap, memberSnap, vaultSnap] = await Promise.all([tx.get(groupRef), tx.get(groupRef.collection('members').doc(uid)), tx.get(vaultRef)]);
    if (!groupSnap.exists || !memberSnap.exists) throw new HttpsError('permission-denied', 'You are not a member of this group.');
    if (memberSnap.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Only group admins can record a manual contribution.');
    const current = Number(vaultSnap.data()?.balancePaise ?? 0);
    tx.set(vaultRef, { balancePaise: current + amountPaise, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(ledgerRef, { type: 'manual_cash_contribution', amountPaise, description, actorUid: uid, verification: 'manual_unverified', createdAt: FieldValue.serverTimestamp() });
  });
  return { ledgerEntryId: ledgerRef.id, verification: 'manual_unverified' };
});
export const health = onCall(async request => { requireUid(request.auth?.uid); return { ok: true, region: 'asia-south1' }; });
