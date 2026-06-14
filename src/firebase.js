import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, getDoc } from "firebase/firestore";

// Credenciales del proyecto Firebase de El Completito Hualpén.
const firebaseConfig = {
  apiKey: "AIzaSyDQK33EsP4jB1qJBJuhT0U3DrJwU7-3jPk",
  authDomain: "completito-hualpen.firebaseapp.com",
  projectId: "completito-hualpen",
  storageBucket: "completito-hualpen.firebasestorage.app",
  messagingSenderId: "868213451742",
  appId: "1:868213451742:web:16f721fffe2c200ec10b4f"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const REF = () => doc(db, "tienda", "completito-hualpen");

// Mantiene los datos tal cual, incluyendo imágenes base64.
function preserveData(obj) { return obj; }

export async function firebasePush(STORAGE_KEYS) {
  const data = {};
  for (const [name, key] of Object.entries(STORAGE_KEYS)) {
    const v = localStorage.getItem(key);
    if (v) {
      try { data[name] = preserveData(JSON.parse(v)); }
      catch { data[name] = null; }
    } else { data[name] = null; }
  }
  await setDoc(REF(), { ...data, updatedAt: Date.now() }, { merge: true });
}

export async function firebasePull(STORAGE_KEYS) {
  const snap = await getDoc(REF());
  if (!snap.exists()) return false;
  const data = snap.data();
  for (const [name, key] of Object.entries(STORAGE_KEYS)) {
    if (data[name] !== undefined && data[name] !== null) {
      localStorage.setItem(key, JSON.stringify(data[name]));
    }
  }
  return true;
}

export function firebaseSubscribe(STORAGE_KEYS, onUpdate) {
  return onSnapshot(REF(), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    for (const [name, key] of Object.entries(STORAGE_KEYS)) {
      if (data[name] !== undefined && data[name] !== null) {
        localStorage.setItem(key, JSON.stringify(data[name]));
      }
    }
    onUpdate(data);
  });
}
