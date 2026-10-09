import { initializeApp, deleteApp } from 'firebase/app';
import { sha256 } from 'js-sha256';
import {
  getAuth, connectAuthEmulator, createUserWithEmailAndPassword, sendEmailVerification, signOut,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

export let app;
export let auth;
export let db;
let config;
const usarEmulador = import.meta.env.VITE_USE_EMULATOR === 'true';

// Donos do sistema, guardados apenas como SHA-256 do e-mail.
const DONOS_HASH = [
  '69ebe653af500dc42f13d4d34d60e8119470836e9c6b7bbd761ea8ff80a59837',
  '362edb2239b749446ae82b2c1ef01ed0643185c1e79ce2583e79f1d0ada6da12',
];
export const ehDono = (email) => DONOS_HASH.includes(sha256(String(email || '').trim().toLowerCase()));

async function carregarConfig() {
  const env = import.meta.env;
  if (env.VITE_FIREBASE_API_KEY) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    };
  }
  // No Firebase Hosting a configuração do projeto é servida automaticamente.
  const resp = await fetch('/__/firebase/init.json');
  if (!resp.ok) throw new Error('Configuração do Firebase não encontrada.');
  return resp.json();
}

export async function iniciarFirebase() {
  config = await carregarConfig();
  app = initializeApp(config);
  auth = getAuth(app);
  auth.languageCode = 'pt';
  db = getFirestore(app);
  if (usarEmulador) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

// Cria a conta de outro usuário sem derrubar a sessão de quem está logado.
export async function criarContaUsuario(email, senha) {
  const secundario = initializeApp(config, `novo-usuario-${Date.now()}`);
  try {
    const authSec = getAuth(secundario);
    authSec.languageCode = 'pt';
    if (usarEmulador) connectAuthEmulator(authSec, 'http://127.0.0.1:9099', { disableWarnings: true });
    const cred = await createUserWithEmailAndPassword(authSec, email, senha);
    await sendEmailVerification(cred.user);
    await signOut(authSec);
  } finally {
    await deleteApp(secundario);
  }
}
