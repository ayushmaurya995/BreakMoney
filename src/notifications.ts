import { getMessaging, getToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';
import { httpsCallable } from 'firebase/functions';
import { app, firebaseConfigured, functions } from './firebase';

export async function enablePushNotifications(): Promise<void> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured.');
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error('Add VITE_FIREBASE_VAPID_KEY from Firebase Console to .env.local.');
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported())) {
    throw new Error('Push notifications are not supported in this browser.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const params = new URLSearchParams({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  });
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js?' + params.toString());
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Firebase did not return a device token.');
  await httpsCallable(functions, 'registerDeviceToken')({ token });
}

export async function listenForNotifications(callback: (payload: MessagePayload) => void): Promise<(() => void) | null> {
  if (!(await isSupported())) return null;
  return onMessage(getMessaging(app), callback);
}
