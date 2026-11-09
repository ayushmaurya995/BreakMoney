import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onCall, onRequest, HttpsError } from './_lib/runtime.js';
import { defineSecret } from './_lib/runtime.js';
import { splitEqually, validateCustomSplit, calculateSettlementTransfers } from '../functions/src/domain.js';
import { setGlobalOptions } from './_lib/runtime.js';
initializeApp();
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });
const db = getFirestore();
const requireUid = (uid?: string) => { if (!uid) throw new HttpsError('unauthenticated', 'Please sign in first.'); return uid; };
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

async function notifyGroupMembers(groupId: string, title: string, body: string, excludeUid?: string) {
  try {
    const members = await db.collection('groups').doc(groupId).collection('members').where('status', '==', 'active').get();
    const tokenRows: Array<{ token: string; remove: () => Promise<unknown> }> = [];
    for (const member of members.docs) {
      if (member.id === excludeUid) continue;
      const tokens = await db.collection('users').doc(member.id).collection('deviceTokens').get();
      for (const tokenDoc of tokens.docs) {
        const token = String(tokenDoc.data().token ?? '');
        if (token) tokenRows.push({ token, remove: () => tokenDoc.ref.delete() });
      }
    }
    for (let offset = 0; offset < tokenRows.length; offset += 500) {
      const batch = tokenRows.slice(offset, offset + 500);
      const result = await getMessaging().sendEachForMulticast({
        tokens: batch.map(row => row.token),
        notification: { title, body },
        data: { groupId }
      });
      await Promise.all(result.responses.map((item, index) => {
        const code = item.error?.code ?? '';
        return ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)
          ? batch[index].remove()
          : Promise.resolve();
      }));
    }
  } catch (error) {
    console.error('Group notification delivery failed:', error);
  }
}

export const registerDeviceToken = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  if (request.auth?.token.email_verified !== true) throw new HttpsError('permission-denied', 'Verify your email before enabling notifications.');
  const token = String(request.data?.token ?? '');
  if (token.length < 50 || token.length > 4096) throw new HttpsError('invalid-argument', 'Invalid notification device token.');
  const id = tokenHash(token);
  await db.collection('users').doc(uid).collection('deviceTokens').doc(id).set({
    token, platform: 'web', updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { registered: true };
});

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
    const splitType = request.data?.splitType === 'custom' ? 'custom' : 'equal';
    let shares: Array<{ uid: string; amountPaise: number }>;
    try {
      shares = splitType === 'custom'
        ? validateCustomSplit(amountPaise, members, request.data?.shares)
        : splitEqually(amountPaise, members);
    } catch (error) {
      throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'Invalid expense split.');
    }
    tx.create(expenseRef, { description, amountPaise, currency: 'INR', category: 'General', paidBy: uid, splitType, shares, createdBy: uid, createdAt: FieldValue.serverTimestamp(), status: 'recorded' });
    tx.create(groupRef.collection('ledger').doc(), { type: 'expense_recorded', referenceId: expenseRef.id, amountPaise, actorUid: uid, description, createdAt: FieldValue.serverTimestamp(), status: 'recorded' });
  });
  await notifyGroupMembers(groupId, 'New group expense', description, uid);
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
  await notifyGroupMembers(groupId, 'Vault cash entry recorded', description, uid);
  return { ledgerEntryId: ledgerRef.id, verification: 'manual_unverified' };
});
export const getSettlementSuggestions = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  if (!groupId) throw new HttpsError('invalid-argument', 'Group is required.');
  const groupRef = db.collection('groups').doc(groupId);
  const memberSnap = await groupRef.collection('members').doc(uid).get();
  if (!memberSnap.exists) throw new HttpsError('permission-denied', 'You are not a member of this group.');
  const [expenseSnap, settlementSnap] = await Promise.all([
    groupRef.collection('expenses').where('status', '==', 'recorded').get(),
    groupRef.collection('settlementReports').where('status', '==', 'confirmed_by_parties').get()
  ]);
  const transfers = calculateSettlementTransfers(expenseSnap.docs.map(doc => {
    const expense = doc.data();
    return {
      amountPaise: Number(expense.amountPaise),
      paidBy: String(expense.paidBy ?? ''),
      shares: (expense.shares ?? []) as Array<{ uid: string; amountPaise: number }>
    };
  }), settlementSnap.docs.map(doc => {
    const report = doc.data();
    return { fromUid: String(report.fromUid), toUid: String(report.toUid), amountPaise: Number(report.amountPaise) };
  }));
  return {transfers, computedAt:new Date().toISOString(), note:'Suggestions only. No payment has been initiated or verified.'};
});
export const health = onCall(async request => { requireUid(request.auth?.uid); return { ok: true, region: 'asia-south1' }; });

export const getGroupMembers = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  if (!groupId) throw new HttpsError('invalid-argument', 'Group is required.');
  const groupRef = db.collection('groups').doc(groupId);
  const memberSnap = await groupRef.collection('members').doc(uid).get();
  if (!memberSnap.exists) throw new HttpsError('permission-denied', 'You are not a member of this group.');
  const membersSnap = await groupRef.collection('members').where('status', '==', 'active').get();
  const members = await Promise.all(membersSnap.docs.map(async memberDoc => {
    const member = memberDoc.data();
    const profileSnap = await db.collection('users').doc(memberDoc.id).get();
    const profile = profileSnap.data() ?? {};
    return {
      uid: memberDoc.id,
      displayName: String(profile.displayName ?? profile.email ?? 'BreakMoney member').slice(0, 80),
      email: String(profile.email ?? '').slice(0, 160),
      role: member.role === 'admin' ? 'admin' : 'member',
      joinedAt: member.joinedAt?.toDate?.()?.toISOString?.() ?? null
    };
  }));
  return { members };
});

export const getGroupLedger = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  if (!groupId) throw new HttpsError('invalid-argument', 'Group is required.');
  const groupRef = db.collection('groups').doc(groupId);
  const memberSnap = await groupRef.collection('members').doc(uid).get();
  if (!memberSnap.exists) throw new HttpsError('permission-denied', 'You are not a member of this group.');
  const ledgerSnap = await groupRef.collection('ledger').orderBy('createdAt', 'desc').limit(25).get();
  return {
    entries: ledgerSnap.docs.map(entryDoc => {
      const entry = entryDoc.data();
      return {
        id: entryDoc.id,
        type: String(entry.type ?? 'activity'),
        description: String(entry.description ?? entry.type ?? 'Group activity').slice(0, 120),
        amountPaise: Number(entry.amountPaise ?? 0),
        verification: String(entry.verification ?? ''),
        createdAt: entry.createdAt?.toDate?.()?.toISOString?.() ?? null
      };
    })
  };
});

export const setGroupMemberRole = onCall(async request => {
  const actorUid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const targetUid = String(request.data?.targetUid ?? '');
  const role = request.data?.role;
  if (!groupId || !targetUid || !['admin', 'member'].includes(role)) throw new HttpsError('invalid-argument', 'Provide a group, member and valid role.');
  const groupRef = db.collection('groups').doc(groupId);
  await db.runTransaction(async tx => {
    const actorRef = groupRef.collection('members').doc(actorUid);
    const targetRef = groupRef.collection('members').doc(targetUid);
    const [groupSnap, actorSnap, targetSnap] = await Promise.all([tx.get(groupRef), tx.get(actorRef), tx.get(targetRef)]);
    if (!groupSnap.exists || !actorSnap.exists || actorSnap.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Only group admins can manage roles.');
    if (!targetSnap.exists || targetSnap.data()?.status !== 'active') throw new HttpsError('not-found', 'Active member not found.');
    if (groupSnap.data()?.createdBy === targetUid && role !== 'admin') throw new HttpsError('failed-precondition', 'The group creator must remain an admin.');
    if (targetSnap.data()?.role === 'admin' && role === 'member') {
      const admins = await tx.get(groupRef.collection('members').where('role', '==', 'admin').where('status', '==', 'active'));
      if (admins.size <= 1) throw new HttpsError('failed-precondition', 'A group must always have at least one admin.');
    }
    tx.update(targetRef, { role, updatedAt: FieldValue.serverTimestamp() });
    tx.set(db.collection('users').doc(targetUid).collection('groupMemberships').doc(groupId), { role, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(groupRef.collection('ledger').doc(), { type: 'member_role_changed', description: 'Member role updated', actorUid, targetUid, role, createdAt: FieldValue.serverTimestamp() });
  });
  return { updated: true };
});

export const removeGroupMember = onCall(async request => {
  const actorUid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const targetUid = String(request.data?.targetUid ?? '');
  if (!groupId || !targetUid || actorUid === targetUid) throw new HttpsError('invalid-argument', 'Choose another member to remove.');
  const groupRef = db.collection('groups').doc(groupId);
  await db.runTransaction(async tx => {
    const [groupSnap, actorSnap, targetSnap] = await Promise.all([
      tx.get(groupRef), tx.get(groupRef.collection('members').doc(actorUid)), tx.get(groupRef.collection('members').doc(targetUid))
    ]);
    if (!groupSnap.exists || !actorSnap.exists || actorSnap.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Only group admins can remove members.');
    if (!targetSnap.exists) throw new HttpsError('not-found', 'Member not found.');
    if (groupSnap.data()?.createdBy === targetUid) throw new HttpsError('failed-precondition', 'The group creator cannot be removed.');
    if (targetSnap.data()?.role === 'admin') {
      const admins = await tx.get(groupRef.collection('members').where('role', '==', 'admin').where('status', '==', 'active'));
      if (admins.size <= 1) throw new HttpsError('failed-precondition', 'Promote another admin before removing this member.');
    }
    const members: string[] = groupSnap.data()?.memberUids ?? [];
    tx.delete(groupRef.collection('members').doc(targetUid));
    tx.delete(db.collection('users').doc(targetUid).collection('groupMemberships').doc(groupId));
    tx.update(groupRef, { memberUids: members.filter(id => id !== targetUid), updatedAt: FieldValue.serverTimestamp() });
    tx.create(groupRef.collection('ledger').doc(), { type: 'member_removed', description: 'Member removed from group', actorUid, targetUid, createdAt: FieldValue.serverTimestamp() });
  });
  return { removed: true };
});

export const leaveGroup = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  if (!groupId) throw new HttpsError('invalid-argument', 'Group is required.');
  const groupRef = db.collection('groups').doc(groupId);
  await db.runTransaction(async tx => {
    const [groupSnap, memberSnap] = await Promise.all([tx.get(groupRef), tx.get(groupRef.collection('members').doc(uid))]);
    if (!groupSnap.exists || !memberSnap.exists) throw new HttpsError('not-found', 'Group membership not found.');
    if (groupSnap.data()?.createdBy === uid) throw new HttpsError('failed-precondition', 'The group creator cannot leave. Transfer ownership first.');
    if (memberSnap.data()?.role === 'admin') {
      const admins = await tx.get(groupRef.collection('members').where('role', '==', 'admin').where('status', '==', 'active'));
      if (admins.size <= 1) throw new HttpsError('failed-precondition', 'Promote another admin before leaving.');
    }
    const members: string[] = groupSnap.data()?.memberUids ?? [];
    tx.delete(groupRef.collection('members').doc(uid));
    tx.delete(db.collection('users').doc(uid).collection('groupMemberships').doc(groupId));
    tx.update(groupRef, { memberUids: members.filter(id => id !== uid), updatedAt: FieldValue.serverTimestamp() });
    tx.create(groupRef.collection('ledger').doc(), { type: 'member_left', description: 'Member left the group', actorUid: uid, createdAt: FieldValue.serverTimestamp() });
  });
  return { left: true };
});

export const revokeInvite = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const inviteId = String(request.data?.inviteId ?? '');
  if (!groupId || !inviteId || !/^[a-f0-9]{64}$/.test(inviteId)) throw new HttpsError('invalid-argument', 'Invalid invite reference.');
  const groupRef = db.collection('groups').doc(groupId);
  const inviteRef = db.collection('groupInvites').doc(inviteId);
  await db.runTransaction(async tx => {
    const [memberSnap, inviteSnap] = await Promise.all([tx.get(groupRef.collection('members').doc(uid)), tx.get(inviteRef)]);
    if (!memberSnap.exists || memberSnap.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Only group admins can revoke invites.');
    if (!inviteSnap.exists || inviteSnap.data()?.groupId !== groupId) throw new HttpsError('not-found', 'Invite not found.');
    tx.update(inviteRef, { status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: uid });
  });
  return { revoked: true };
});

export const listGroupInvites = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  if (!groupId) throw new HttpsError('invalid-argument', 'Group is required.');
  const groupRef = db.collection('groups').doc(groupId);
  const memberSnap = await groupRef.collection('members').doc(uid).get();
  if (!memberSnap.exists || memberSnap.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Only group admins can view invites.');
  const invites = await db.collection('groupInvites').where('groupId', '==', groupId).limit(20).get();
  const ordered = [...invites.docs].sort((a, b) => (b.data().createdAt?.toMillis?.() ?? 0) - (a.data().createdAt?.toMillis?.() ?? 0));
  return { invites: ordered.map(d => ({ id: d.id, status: d.data().status, uses: d.data().uses ?? 0, maxUses: d.data().maxUses ?? 0, expiresAt: d.data().expiresAt?.toDate?.()?.toISOString?.() ?? null })) };
});

const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');
const razorpayWebhookSecret = defineSecret('RAZORPAY_WEBHOOK_SECRET');

function razorpayAuthorization() {
  const id = razorpayKeyId.value();
  const secret = razorpayKeySecret.value();
  if (!id || !secret) throw new HttpsError('failed-precondition', 'Razorpay is not configured. Ask the project administrator to set payment secrets.');
  return { id, header: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64') };
}

async function finalizeCapturedPayment(orderId: string, paymentId: string, amount: number, currency: string) {
  const orderRef = db.collection('razorpayOrders').doc(orderId);
  const newlyCaptured = await db.runTransaction(async tx => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new HttpsError('not-found', 'Payment order was not found.');
    const order = orderSnap.data()!;
    if (Number(order.amountPaise) !== amount || order.currency !== currency || currency !== 'INR') throw new HttpsError('failed-precondition', 'Payment amount or currency does not match the order.');
    if (order.status === 'captured') {
      if (order.paymentId !== paymentId) throw new HttpsError('already-exists', 'This order was already completed with another payment.');
      return false;
    }
    if (order.status !== 'created') throw new HttpsError('failed-precondition', 'This payment order is no longer payable.');
    const groupRef = db.collection('groups').doc(String(order.groupId));
    const vaultRef = groupRef.collection('vault').doc('summary');
    const ledgerRef = groupRef.collection('ledger').doc();
    const [groupSnap, vaultSnap] = await Promise.all([tx.get(groupRef), tx.get(vaultRef)]);
    if (!groupSnap.exists || groupSnap.data()?.status !== 'active') throw new HttpsError('failed-precondition', 'This group is no longer active.');
    const current = Number(vaultSnap.data()?.balancePaise ?? 0);
    if (!Number.isSafeInteger(current + amount)) throw new HttpsError('out-of-range', 'Vault balance is outside the supported range.');
    tx.set(vaultRef, { balancePaise: current + amount, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(orderRef, { status: 'captured', paymentId, capturedAt: FieldValue.serverTimestamp() });
    tx.create(ledgerRef, { type: 'verified_digital_contribution', description: 'Verified Razorpay contribution', amountPaise: amount, actorUid: order.uid, paymentProvider: 'razorpay', paymentOrderId: orderId, paymentId, verification: 'provider_captured', createdAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (newlyCaptured) {
    const savedOrder = (await orderRef.get()).data();
    await notifyGroupMembers(String(savedOrder?.groupId ?? ''), 'Vault contribution received', 'A verified contribution was added to your group vault.', String(savedOrder?.uid ?? ''));
  }
}

export const createRazorpayOrder = onCall({ secrets: [razorpayKeyId, razorpayKeySecret] }, async request => {
  const uid = requireUid(request.auth?.uid);
  if (request.auth?.token.email_verified !== true) throw new HttpsError('permission-denied', 'Verify your email before making a payment.');
  const groupId = String(request.data?.groupId ?? '');
  const amountPaise = validAmount(request.data?.amountPaise);
  if (amountPaise < 100 || amountPaise > 5000000) throw new HttpsError('invalid-argument', 'Contribution must be between ₹1 and ₹50,000.');
  const groupRef = db.collection('groups').doc(groupId);
  const [groupSnap, memberSnap] = await Promise.all([groupRef.get(), groupRef.collection('members').doc(uid).get()]);
  if (!groupId || !groupSnap.exists || groupSnap.data()?.status !== 'active' || !memberSnap.exists) throw new HttpsError('permission-denied', 'You must be an active member of this group to contribute.');
  const auth = razorpayAuthorization();
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: auth.header, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: randomBytes(12).toString('hex'), notes: { groupId, uid } })
  });
  const data = await response.json() as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
  if (!response.ok || !data.id || data.amount !== amountPaise || data.currency !== 'INR') throw new HttpsError('internal', data.error?.description ?? 'Razorpay could not create the payment order.');
  await db.collection('razorpayOrders').doc(data.id).create({ groupId, uid, amountPaise, currency: 'INR', status: 'created', createdAt: FieldValue.serverTimestamp() });
  return { keyId: auth.id, orderId: data.id, amount: amountPaise, currency: 'INR', name: 'BreakMoney', description: 'Group vault contribution' };
});

export const verifyRazorpayPayment = onCall({ secrets: [razorpayKeyId, razorpayKeySecret] }, async request => {
  const uid = requireUid(request.auth?.uid);
  const orderId = String(request.data?.orderId ?? '');
  const paymentId = String(request.data?.paymentId ?? '');
  const signature = String(request.data?.signature ?? '');
  if (!orderId || !paymentId || !/^[a-f0-9]{64}$/i.test(signature)) throw new HttpsError('invalid-argument', 'Payment verification details are incomplete.');
  const orderRef = db.collection('razorpayOrders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists || orderSnap.data()?.uid !== uid) throw new HttpsError('permission-denied', 'This payment order does not belong to you.');
  const auth = razorpayAuthorization();
  const expected = createHmac('sha256', razorpayKeySecret.value()).update(orderId + '|' + paymentId).digest();
  const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpsError('permission-denied', 'Payment signature verification failed.');
  const response = await fetch('https://api.razorpay.com/v1/payments/' + encodeURIComponent(paymentId), { headers: { Authorization: auth.header } });
  const payment = await response.json() as { id?: string; order_id?: string; amount?: number; currency?: string; status?: string; error?: { description?: string } };
  if (!response.ok || payment.order_id !== orderId || payment.status !== 'captured') throw new HttpsError('failed-precondition', payment.error?.description ?? 'Payment is not yet captured by Razorpay.');
  await finalizeCapturedPayment(orderId, paymentId, Number(payment.amount), String(payment.currency));
  return { verified: true, status: 'captured' };
});

export const razorpayWebhook = onRequest({ secrets: [razorpayWebhookSecret] }, async (request, response) => {
  if (request.method !== 'POST') { response.status(405).send('Method not allowed'); return; }
  const secret = razorpayWebhookSecret.value();
  const signature = String(request.header('x-razorpay-signature') ?? '');
  if (!secret || !signature || !request.rawBody) { response.status(400).send('Missing webhook signature'); return; }
  const expected = createHmac('sha256', secret).update(request.rawBody).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, 'hex'); } catch { response.status(400).send('Invalid signature'); return; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { response.status(401).send('Invalid webhook signature'); return; }
  const event = request.body as { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string; status?: string } } } };
  if (event.event !== 'payment.captured') { response.status(200).send('Event ignored'); return; }
  const payment = event.payload?.payment?.entity;
  if (!payment?.id || !payment.order_id || payment.status !== 'captured' || !Number.isSafeInteger(payment.amount)) { response.status(400).send('Invalid payment payload'); return; }
  try {
    await finalizeCapturedPayment(payment.order_id, payment.id, Number(payment.amount), String(payment.currency));
    response.status(200).send('Payment recorded');
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : 'Could not record payment');
  }
});

export const reportSettlement = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const fromUid = String(request.data?.fromUid ?? '');
  const toUid = String(request.data?.toUid ?? '');
  const amountPaise = validAmount(request.data?.amountPaise);
  const reference = String(request.data?.reference ?? '').trim().slice(0, 80);
  if (!groupId || !fromUid || !toUid || fromUid === toUid || (uid !== fromUid && uid !== toUid)) throw new HttpsError('invalid-argument', 'Only a sender or recipient can report this suggested settlement.');
  const groupRef = db.collection('groups').doc(groupId);
  const reportRef = groupRef.collection('settlementReports').doc();
  const ledgerRef = groupRef.collection('ledger').doc();
  await db.runTransaction(async tx => {
    const [groupSnap, senderSnap, recipientSnap] = await Promise.all([
      tx.get(groupRef), tx.get(groupRef.collection('members').doc(fromUid)), tx.get(groupRef.collection('members').doc(toUid))
    ]);
    if (!groupSnap.exists || !senderSnap.exists || !recipientSnap.exists) throw new HttpsError('failed-precondition', 'Both people must still be active group members.');
    tx.create(reportRef, { fromUid, toUid, amountPaise, reference, reportedBy: uid, status: 'reported_unverified', createdAt: FieldValue.serverTimestamp() });
    tx.create(ledgerRef, { type: 'settlement_reported_unverified', description: 'Settlement reported by a participant; awaiting independent verification', amountPaise, actorUid: uid, referenceId: reportRef.id, verification: 'unverified', createdAt: FieldValue.serverTimestamp() });
  });
  return { reportId: reportRef.id, status: 'reported_unverified', note: 'A report is not proof of payment and does not change settlement balances.' };
});

export const recordVaultSpend = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const description = String(request.data?.description ?? '').trim();
  const amountPaise = validAmount(request.data?.amountPaise);
  if (!groupId || description.length < 2 || description.length > 120) throw new HttpsError('invalid-argument', 'A group and valid description are required.');
  const groupRef = db.collection('groups').doc(groupId);
  const vaultRef = groupRef.collection('vault').doc('summary');
  const ledgerRef = groupRef.collection('ledger').doc();
  let remainingBalance = 0;
  let threshold = 0;
  await db.runTransaction(async tx => {
    const [groupSnap, memberSnap, vaultSnap] = await Promise.all([tx.get(groupRef), tx.get(groupRef.collection('members').doc(uid)), tx.get(vaultRef)]);
    if (!groupSnap.exists || groupSnap.data()?.status !== 'active' || !memberSnap.exists) throw new HttpsError('permission-denied', 'You must be an active group member.');
    if (memberSnap.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Only group admins can record a vault spend.');
    const current = Number(vaultSnap.data()?.balancePaise ?? 0);
    if (current < amountPaise) throw new HttpsError('failed-precondition', 'The vault does not have enough recorded balance for this spend.');
    remainingBalance = current - amountPaise;
    threshold = Number(vaultSnap.data()?.lowBalanceThresholdPaise ?? 0);
    tx.set(vaultRef, { balancePaise: remainingBalance, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(ledgerRef, { type: 'manual_vault_spend', description, amountPaise, actorUid: uid, verification: 'manual_unverified', createdAt: FieldValue.serverTimestamp() });
  });
  await notifyGroupMembers(groupId, 'Group vault spend recorded', description, uid);
  if (threshold > 0 && remainingBalance <= threshold) await notifyGroupMembers(groupId, 'Group vault running low', 'The recorded vault balance has reached its configured low-balance threshold.');
  return { ledgerEntryId: ledgerRef.id, balancePaise: remainingBalance, verification: 'manual_unverified' };
});

export const setVaultLowBalanceThreshold = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const thresholdPaise = Number(request.data?.thresholdPaise);
  if (!groupId || !Number.isSafeInteger(thresholdPaise) || thresholdPaise < 0 || thresholdPaise > 100000000000) throw new HttpsError('invalid-argument', 'Enter a valid threshold in paise.');
  const groupRef = db.collection('groups').doc(groupId);
  await db.runTransaction(async tx => {
    const [groupSnap, memberSnap] = await Promise.all([tx.get(groupRef), tx.get(groupRef.collection('members').doc(uid))]);
    if (!groupSnap.exists || !memberSnap.exists || memberSnap.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Only group admins can change the low-balance alert.');
    tx.set(groupRef.collection('vault').doc('summary'), { lowBalanceThresholdPaise: thresholdPaise, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { thresholdPaise };
});

export const confirmSettlementReport = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const reportId = String(request.data?.reportId ?? '');
  if (!groupId || !reportId) throw new HttpsError('invalid-argument', 'Group and settlement report are required.');
  const groupRef = db.collection('groups').doc(groupId);
  const reportRef = groupRef.collection('settlementReports').doc(reportId);
  await db.runTransaction(async tx => {
    const reportSnap = await tx.get(reportRef);
    if (!reportSnap.exists) throw new HttpsError('not-found', 'Settlement report not found.');
    const report = reportSnap.data()!;
    if (report.status !== 'reported_unverified') throw new HttpsError('failed-precondition', 'This settlement report is no longer awaiting confirmation.');
    if (uid !== report.fromUid && uid !== report.toUid) throw new HttpsError('permission-denied', 'Only the sender or recipient can confirm this report.');
    if (uid === report.reportedBy) throw new HttpsError('permission-denied', 'The person who reported the transfer cannot confirm it themselves.');
    const [groupSnap, senderSnap, recipientSnap, expenseSnap, confirmedSnap] = await Promise.all([
      tx.get(groupRef),
      tx.get(groupRef.collection('members').doc(String(report.fromUid))),
      tx.get(groupRef.collection('members').doc(String(report.toUid))),
      tx.get(groupRef.collection('expenses').where('status', '==', 'recorded')),
      tx.get(groupRef.collection('settlementReports').where('status', '==', 'confirmed_by_parties'))
    ]);
    if (!groupSnap.exists || !senderSnap.exists || !recipientSnap.exists) throw new HttpsError('failed-precondition', 'Both participants must remain active group members.');
    const expenses = expenseSnap.docs.map(doc => {
      const expense = doc.data();
      return { amountPaise: Number(expense.amountPaise), paidBy: String(expense.paidBy ?? ''), shares: (expense.shares ?? []) as Array<{uid:string;amountPaise:number}> };
    });
    const settled = confirmedSnap.docs.map(doc => {
      const item = doc.data();
      return { fromUid: String(item.fromUid), toUid: String(item.toUid), amountPaise: Number(item.amountPaise) };
    });
    const remaining = calculateSettlementTransfers(expenses, settled);
    const matching = remaining.find(item => item.fromUid === report.fromUid && item.toUid === report.toUid);
    if (!matching || Number(report.amountPaise) > matching.amountPaise) throw new HttpsError('failed-precondition', 'This report no longer matches an outstanding suggested settlement.');
    tx.update(reportRef, { status: 'confirmed_by_parties', confirmedBy: uid, confirmedAt: FieldValue.serverTimestamp(), verification: 'party_confirmed_not_provider_verified' });
    tx.create(groupRef.collection('ledger').doc(), { type: 'settlement_confirmed_by_parties', description: 'Settlement acknowledged by both participants; not provider verified', amountPaise: Number(report.amountPaise), actorUid: uid, referenceId: reportId, verification: 'party_confirmed_not_provider_verified', createdAt: FieldValue.serverTimestamp() });
  });
  return { confirmed: true, verification: 'party_confirmed_not_provider_verified' };
});

export const listSettlementReports = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  if (!groupId) throw new HttpsError('invalid-argument', 'Group is required.');
  const groupRef = db.collection('groups').doc(groupId);
  const memberSnap = await groupRef.collection('members').doc(uid).get();
  if (!memberSnap.exists) throw new HttpsError('permission-denied', 'You are not a group member.');
  const snap = await groupRef.collection('settlementReports').limit(30).get();
  const reports = snap.docs.map(doc => {
    const report = doc.data();
    return { id: doc.id, fromUid: String(report.fromUid), toUid: String(report.toUid), amountPaise: Number(report.amountPaise), status: String(report.status), reportedBy: String(report.reportedBy), reference: String(report.reference ?? ''), createdAt: report.createdAt?.toDate?.()?.toISOString?.() ?? null };
  }).sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??''));
  return { reports };
});

export const voidExpense = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  const expenseId = String(request.data?.expenseId ?? '');
  const reason = String(request.data?.reason ?? '').trim().slice(0, 160);
  if (!groupId || !expenseId || reason.length < 3) throw new HttpsError('invalid-argument', 'Provide an expense and a correction reason of at least 3 characters.');
  const groupRef = db.collection('groups').doc(groupId);
  const expenseRef = groupRef.collection('expenses').doc(expenseId);
  await db.runTransaction(async tx => {
    const [groupSnap, memberSnap, expenseSnap] = await Promise.all([tx.get(groupRef), tx.get(groupRef.collection('members').doc(uid)), tx.get(expenseRef)]);
    if (!groupSnap.exists || !memberSnap.exists || !expenseSnap.exists) throw new HttpsError('not-found', 'Group member or expense not found.');
    const expense = expenseSnap.data()!;
    if (expense.status !== 'recorded') throw new HttpsError('failed-precondition', 'Only a recorded expense can be voided.');
    if (memberSnap.data()?.role !== 'admin' && expense.createdBy !== uid) throw new HttpsError('permission-denied', 'Only the expense creator or a group admin can void this entry.');
    tx.update(expenseRef, { status: 'voided', voidedBy: uid, voidReason: reason, voidedAt: FieldValue.serverTimestamp() });
    tx.create(groupRef.collection('ledger').doc(), { type: 'expense_voided', description: 'Expense voided: ' + reason, amountPaise: Number(expense.amountPaise), actorUid: uid, referenceId: expenseId, createdAt: FieldValue.serverTimestamp(), verification: 'correction_entry' });
  });
  await notifyGroupMembers(groupId, 'Group expense corrected', 'An expense was voided with a correction entry.', uid);
  return { voided: true };
});
