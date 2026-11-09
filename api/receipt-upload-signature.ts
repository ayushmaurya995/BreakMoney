import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { createHmac } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp, cert, applicationDefault } from 'firebase-admin/app';

function ensureFirebase() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    initializeApp(raw ? { credential: cert(JSON.parse(raw)) } : { credential: applicationDefault() });
  }
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  ensureFirebase();
  const token = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization!.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please sign in first.' });
  try {
    const decoded = await getAuth().verifyIdToken(token, true);
    const { groupId } = req.body as { groupId?: string };
    if (!groupId || !/^[A-Za-z0-9_-]{10,100}$/.test(groupId)) return res.status(400).json({ error: 'A valid group is required.' });
    const member = await getFirestore().doc(`groups/${groupId}/members/${decoded.uid}`).get();
    if (!member.exists) return res.status(403).json({ error: 'You are not a member of this group.' });
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
    const apiKey = process.env.CLOUDINARY_API_KEY || '';
    const secret = process.env.CLOUDINARY_API_SECRET || '';
    if (!cloudName || !apiKey || !secret) return res.status(503).json({ error: 'Receipt storage is not configured yet.' });
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `breakmoney/groups/${groupId}/receipts`;
    const params = `folder=${folder}&timestamp=${timestamp}`;
    const signature = createHmac('sha1', secret).update(params).digest('hex');
    return res.status(200).json({ cloudName, apiKey, timestamp, folder, signature });
  } catch {
    return res.status(401).json({ error: 'Your session is invalid. Please sign in again.' });
  }
}
