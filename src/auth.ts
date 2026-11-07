import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification, sendPasswordResetEmail, type User } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

export async function register(email: string, password: string): Promise<User> {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await setDoc(doc(db, 'users', credential.user.uid), {
    email: credential.user.email ?? email.trim(),
    displayName: credential.user.displayName ?? email.trim().split('@')[0],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  await sendEmailVerification(credential.user);
  return credential.user;
}
export async function login(email: string, password: string): Promise<User> {
  return (await signInWithEmailAndPassword(auth, email.trim(), password)).user;
}
export const logout = () => signOut(auth);
export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email.trim());
