import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import * as handlers from './_lib/handlers.js';

function ensureFirebase() {
  if (getApps().length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  initializeApp(raw ? { credential: cert(JSON.parse(raw)) } : { credential: applicationDefault() });
}
export const config = { api: { bodyParser: false } };
async function readBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
export default async function handler(req: VercelRequest & { rawBody?: Buffer }, res: VercelResponse) {
  ensureFirebase();
  const rawBody = await readBody(req);
  req.rawBody = rawBody;
  if (req.url?.startsWith('/api/razorpay-webhook')) {
    try { req.body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {}; }
    catch { return res.status(400).send('Invalid JSON'); }
    return handlers.razorpayWebhook(req as any, res as any);
  }
  const match = req.url?.match(/^\/api\/call\/([A-Za-z0-9_]+)(?:\?.*)?$/);
  if (!match) return res.status(404).json({ error: 'API route not found.' });
  const name = match[1] as keyof typeof handlers;
  const callable = handlers[name];
  if (typeof callable !== 'function' || name === 'razorpayWebhook') return res.status(404).json({ error: 'API action not found.' });
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please sign in first.' });
  try {
    const decoded = await getAuth().verifyIdToken(token, true);
    const data = req.method === 'POST' && rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
    const result = await (callable as any)({ auth: { uid: decoded.uid, token: decoded }, data });
    return res.status(200).json({ data: result });
  } catch (error: any) {
    const status = error?.code === 'unauthenticated' ? 401 :
      ['permission-denied'].includes(error?.code) ? 403 :
      ['not-found'].includes(error?.code) ? 404 :
      ['invalid-argument'].includes(error?.code) ? 400 :
      ['failed-precondition'].includes(error?.code) ? 409 : 500;
    return res.status(status).json({ error: error?.message ?? 'Internal server error.', code: error?.code ?? 'internal' });
  }
}
