import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const resolvedConfig = {
  ...firebaseConfig,
  apiKey:
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_API_KEY) ||
    (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_API_KEY) ||
    firebaseConfig.apiKey ||
    '',
  projectId:
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID) ||
    (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_PROJECT_ID) ||
    firebaseConfig.projectId ||
    'synapse-workbench',
  appId:
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_APP_ID) ||
    (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_APP_ID) ||
    firebaseConfig.appId ||
    '',
  authDomain:
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN) ||
    (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_AUTH_DOMAIN) ||
    firebaseConfig.authDomain ||
    '',
};

const app = getApps().length ? getApp() : initializeApp(resolvedConfig);

const dbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
export const db = dbId ? getFirestore(app, dbId) : getFirestore(app);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.addScope(DRIVE_READONLY_SCOPE);
googleAuthProvider.addScope(DRIVE_FILE_SCOPE);
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

// Strictly in-memory OAuth access token cache (never persisted to localStorage or sessionStorage)
let cachedDriveAccessToken: string | null = null;

export function setDriveAccessToken(token: string | null): void {
  cachedDriveAccessToken = token && token.trim() ? token.trim() : null;
}

export function getDriveAccessToken(): string | null {
  return cachedDriveAccessToken;
}

export function clearDriveAccessToken(): void {
  cachedDriveAccessToken = null;
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    cachedDriveAccessToken = null;
  }
});

export async function signInWithGoogleWorkspace(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  const result = await signInWithPopup(auth, googleAuthProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken ?? null;
  setDriveAccessToken(token);
  return { user: result.user, accessToken: token };
}
