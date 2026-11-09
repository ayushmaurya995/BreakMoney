import { auth } from './firebase';
type CallableResult<T> = { data: T };
export function httpsCallable<T = unknown>(_functions: unknown, name: string) {
  return async (data: unknown = {}): Promise<CallableResult<T>> => {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in first.');
    const token = await user.getIdToken();
    const response = await fetch('/api/call/' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(data)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
    return payload as CallableResult<T>;
  };
}
