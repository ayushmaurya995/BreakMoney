import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
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
export const getSettlementSuggestions = onCall(async request => {
  const uid = requireUid(request.auth?.uid);
  const groupId = String(request.data?.groupId ?? '');
  if (!groupId) throw new HttpsError('invalid-argument', 'Group is required.');
  const groupRef = db.collection('groups').doc(groupId);
  const memberSnap = await groupRef.collection('members').doc(uid).get();
  if (!memberSnap.exists) throw new HttpsError('permission-denied', 'You are not a member of this group.');
  const expenseSnap = await groupRef.collection('expenses').where('status', '==', 'recorded').get();
  const net = new Map<string, number>();
  for (const expenseDoc of expenseSnap.docs) {
    const expense = expenseDoc.data();
    const amount = Number(expense.amountPaise);
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    const payer = String(expense.paidBy ?? '');
    if (!payer) continue;
    net.set(payer, (net.get(payer) ?? 0) + amount);
    for (const share of (expense.shares ?? []) as Array<{uid:string;amountPaise:number}>) {
      if (typeof share.uid !== 'string' || !Number.isSafeInteger(share.amountPaise)) continue;
      net.set(share.uid, (net.get(share.uid) ?? 0) - share.amountPaise);
    }
  }
  const creditors = [...net.entries()].filter(([,value]) => value > 0).map(([memberUid,value])=>({uid:memberUid,amount:value})).sort((a,b)=>b.amount-a.amount);
  const debtors = [...net.entries()].filter(([,value]) => value < 0).map(([memberUid,value])=>({uid:memberUid,amount:-value})).sort((a,b)=>b.amount-a.amount);
  const transfers: Array<{fromUid:string;toUid:string;amountPaise:number}> = [];
  let i=0,j=0;
  while(i<debtors.length && j<creditors.length){
    const amount=Math.min(debtors[i].amount,creditors[j].amount);
    if(amount>0)transfers.push({fromUid:debtors[i].uid,toUid:creditors[j].uid,amountPaise:amount});
    debtors[i].amount-=amount;creditors[j].amount-=amount;
    if(debtors[i].amount===0)i++;
    if(creditors[j].amount===0)j++;
  }
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
  const invites = await db.collection('groupInvites').where('groupId', '==', groupId).orderBy('createdAt', 'desc').limit(20).get();
  return { invites: invites.docs.map(d => ({ id: d.id, status: d.data().status, uses: d.data().uses ?? 0, maxUses: d.data().maxUses ?? 0, expiresAt: d.data().expiresAt?.toDate?.()?.toISOString?.() ?? null })) };
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
  await db.runTransaction(async tx => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new HttpsError('not-found', 'Payment order was not found.');
    const order = orderSnap.data()!;
    if (Number(order.amountPaise) !== amount || order.currency !== currency || currency !== 'INR') throw new HttpsError('failed-precondition', 'Payment amount or currency does not match the order.');
    if (order.status === 'captured') {
      if (order.paymentId !== paymentId) throw new HttpsError('already-exists', 'This order was already completed with another payment.');
      return;
    }
    if (order.status !== 'created') throw new HttpsError('failed-precondition', 'This payment order is no longer payable.');
    const groupRef = db.collection('groups').doc(String(order.groupId));
    const vaultRef = groupRef.collection('vault').doc('summary');
    const ledgerRef = groupRef.collection('ledger').doc();
    const vaultSnap = await tx.get(vaultRef);
    const current = Number(vaultSnap.data()?.balancePaise ?? 0);
    if (!Number.isSafeInteger(current + amount)) throw new HttpsError('out-of-range', 'Vault balance is outside the supported range.');
    tx.set(vaultRef, { balancePaise: current + amount, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(orderRef, { status: 'captured', paymentId, capturedAt: FieldValue.serverTimestamp() });
    tx.create(ledgerRef, { type: 'verified_digital_contribution', description: 'Verified Razorpay contribution', amountPaise: amount, actorUid: order.uid, paymentProvider: 'razorpay', paymentOrderId: orderId, paymentId, verification: 'provider_captured', createdAt: FieldValue.serverTimestamp() });
  });
}

export const createRazorpayOrder = onCall({ secrets: [razorpayKeyId, razorpayKeySecret] }, async request => {
  const uid = requireUid(request.auth?.uid);
  if (request.auth?.token.email_verified !== true) throw new HttpsError('permission-denied', 'Verify your email before making a payment.');
  const groupId = String(request.data?.groupId ?? '');
  const amountPaise = validAmount(request.data?.amountPaise);
  if (amountPaise < 100 || amountPaise > 5000000) throw new HttpsError('invalid-argument', 'Contribution must be between ₹1 and ₹50,000.');
  const groupRef = db.collection('groups').doc(groupId);
  const memberSnap = await groupRef.collection('members').doc(uid).get();
  if (!groupId || !memberSnap.exists) throw new HttpsError('permission-denied', 'You must be a group member to contribute.');
  const auth = razorpayAuthorization();
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: auth.header, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: randomBytes(12).toString('hex'), payment_capture: 1, notes: { groupId, uid } })
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
