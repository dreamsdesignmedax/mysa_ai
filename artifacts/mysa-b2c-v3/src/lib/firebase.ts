import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const apiKey            = import.meta.env["VITE_FIREBASE_API_KEY"]            as string | undefined;
const authDomain        = import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"]        as string | undefined;
const projectId         = import.meta.env["VITE_FIREBASE_PROJECT_ID"]         as string | undefined;
const storageBucket     = import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"]     as string | undefined;
const messagingSenderId = import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"] as string | undefined;
const appId             = import.meta.env["VITE_FIREBASE_APP_ID"]             as string | undefined;
const measurementId     = import.meta.env["VITE_FIREBASE_MEASUREMENT_ID"]     as string | undefined;

export const firebaseConfigured = !!(apiKey && projectId && appId);

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!_auth) {
    if (!apiKey || !projectId || !appId) {
      throw new Error("Firebase is not configured. Add VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID.");
    }
    _app = getApps().length
      ? getApps()[0]!
      : initializeApp({
          apiKey,
          authDomain:        authDomain        ?? `${projectId}.firebaseapp.com`,
          projectId,
          storageBucket:     storageBucket     ?? `${projectId}.firebasestorage.app`,
          messagingSenderId: messagingSenderId ?? "",
          appId,
          measurementId,
        });
    _auth = getAuth(_app);
  }
  return _auth!;
}
