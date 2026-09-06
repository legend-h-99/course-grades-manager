// IndexedDB can structured-clone a non-extractable CryptoKey. Keeping it here
// lets a tab decrypt its sessionStorage after reload without exporting key bytes.
let keyPromise: Promise<CryptoKey> | undefined;

export function getSessionKey(): Promise<CryptoKey> {
  if (!keyPromise) keyPromise = loadKey().catch((error) => {
    keyPromise = undefined;
    throw error;
  });
  return keyPromise;
}

async function loadKey(): Promise<CryptoKey> {
  const candidate = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("sanad-auth", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("keys");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      // A read/write transaction serializes first use across concurrent tabs.
      const transaction = db.transaction("keys", "readwrite");
      const store = transaction.objectStore("keys");
      const request = store.get("session-v1");
      let key: CryptoKey;
      request.onsuccess = () => {
        key = request.result ?? candidate;
        if (!request.result) store.put(key, "session-v1");
      };
      transaction.oncomplete = () => { db.close(); resolve(key); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  });
}
