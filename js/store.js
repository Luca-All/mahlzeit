// Datenschicht. Zwei Backends mit derselben Schnittstelle:
// Firebase (echter Sync) und Demo (localStorage, nur dieses Gerät).
import { firebaseConfig } from './config.js';

const FIREBASE = 'https://www.gstatic.com/firebasejs/13.1.0';
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // ohne 0/O und 1/I

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
export const normalizeCode = (s) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');
export const formatCode = (code) => code.match(/.{1,4}/g).join('-');
export const newCode = () => Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  (b) => CODE_ALPHABET[b & 31]
).join('');

export function createStore() {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  return firebaseConfig && !forceDemo ? createFirebaseStore() : createDemoStore();
}

async function createFirebaseStore() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${FIREBASE}/firebase-app.js`),
    import(`${FIREBASE}/firebase-auth.js`),
    import(`${FIREBASE}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const authentication = auth.getAuth(app);
  await authentication.authStateReady();
  if (!authentication.currentUser) await auth.signInAnonymously(authentication);

  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const householdRef = (code) => fs.doc(db, 'households', code);

  return {
    demo: false,
    async getHousehold(code) {
      const snap = await fs.getDocFromServer(householdRef(code));
      return snap.exists() ? snap.data() : null;
    },
    createHousehold: (code, data) => fs.setDoc(householdRef(code), data),
    updateHousehold: (code, patch) => fs.updateDoc(householdRef(code), patch),
    addMember: (code, id, member) => fs.updateDoc(householdRef(code), { [`members.${id}`]: member }),
    updateMember: (code, id, patch) => fs.updateDoc(householdRef(code), Object.fromEntries(
      Object.entries(patch).map(([k, v]) => [`members.${id}.${k}`, v])
    )),
    subscribe(code, onChange, onError) {
      const unsubs = [
        fs.onSnapshot(householdRef(code), (snap) => {
          // Offline ohne Cache heißt "weiß nicht", nicht "gibt es nicht".
          if (snap.exists()) onChange('household', snap.data());
          else if (!snap.metadata.fromCache) onChange('household', null);
        }, onError),
        ...['dishes', 'cooked', 'wishes'].map((col) => fs.onSnapshot(
          fs.collection(db, 'households', code, col),
          (snap) => onChange(col, snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          onError
        )),
      ];
      return () => unsubs.forEach((u) => u());
    },
    commit(code, ops) {
      const batch = fs.writeBatch(db);
      for (const op of ops) {
        const ref = fs.doc(db, 'households', code, op.col, op.id);
        if (op.type === 'set') batch.set(ref, op.data);
        if (op.type === 'update') batch.update(ref, op.data);
        if (op.type === 'delete') batch.delete(ref);
      }
      return batch.commit();
    },
  };
}

function createDemoStore() {
  const key = (code) => `mahlzeit.demo.${code}`;
  const read = (code) => JSON.parse(localStorage.getItem(key(code)) ?? 'null');
  const listeners = new Set();
  const write = (code, data) => {
    localStorage.setItem(key(code), JSON.stringify(data));
    listeners.forEach((l) => l(code));
  };
  addEventListener('storage', (e) => {
    if (e.key?.startsWith('mahlzeit.demo.')) listeners.forEach((l) => l(e.key.slice(14)));
  });

  return {
    demo: true,
    getHousehold: async (code) => read(code)?.household ?? null,
    createHousehold: async (code, household) => write(code, { household, dishes: {}, cooked: {}, wishes: {} }),
    async updateHousehold(code, patch) {
      const data = read(code);
      Object.assign(data.household, patch);
      write(code, data);
    },
    async addMember(code, id, member) {
      const data = read(code);
      data.household.members[id] = member;
      write(code, data);
    },
    async updateMember(code, id, patch) {
      const data = read(code);
      Object.assign(data.household.members[id], patch);
      write(code, data);
    },
    subscribe(code, onChange) {
      const emit = (changed) => {
        if (changed !== code) return;
        const data = read(code);
        onChange('household', data?.household ?? null);
        if (!data) return;
        for (const col of ['dishes', 'cooked', 'wishes']) {
          onChange(col, Object.entries(data[col]).map(([id, d]) => ({ id, ...d })));
        }
      };
      listeners.add(emit);
      queueMicrotask(() => emit(code));
      return () => listeners.delete(emit);
    },
    async commit(code, ops) {
      const data = read(code);
      for (const op of ops) {
        if (op.type === 'set') data[op.col][op.id] = op.data;
        if (op.type === 'update') Object.assign(data[op.col][op.id], op.data);
        if (op.type === 'delete') delete data[op.col][op.id];
      }
      write(code, data);
    },
  };
}
