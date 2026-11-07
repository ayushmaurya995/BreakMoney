import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification, sendPasswordResetEmail, reload, type User } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

export async function register(email: string, password: string): Promise<User> {
  const cleanEmail = email.trim().toLowerCase();
  const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  await setDoc(doc(db, 'users', credential.user.uid), {
    email: credential.user.email ?? cleanEmail,
    displayName: credential.user.displayName ?? cleanEmail.split('@')[0],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  await sendEmailVerification(credential.user);
  await signOut(auth);
  return credential.user;
}
export async function login(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  await reload(credential.user);
  if (!credential.user.emailVerified) {
    await sendEmailVerification(credential.user);
    await signOut(auth);
    throw new Error('Please verify your email first. We have sent you a fresh verification link.');
  }
  await setDoc(doc(db, 'users', credential.user.uid), {
    email: credential.user.email ?? email.trim().toLowerCase(),
    displayName: credential.user.displayName ?? email.trim().split('@')[0],
    lastLoginAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return credential.user;
}
export const logout = () => signOut(auth);
export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email.trim().toLowerCase());
