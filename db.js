export const DB_NAME = "glamour_makeup_db";
export const DB_VERSION = 1;

const STORES = {
  meta: "meta",
  products: "products",
  sales: "sales",
  cash: "cash",
  stockMoves: "stockMoves",
};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORES.products)) {
        const s = db.createObjectStore(STORES.products, { keyPath: "id" });
        s.createIndex("byName", "name", { unique: false });
        s.createIndex("bySku", "sku", { unique: false });
        s.createIndex("byCategory", "category", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.sales)) {
        const s = db.createObjectStore(STORES.sales, { keyPath: "id" });
        s.createIndex("byDate", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.cash)) {
        const s = db.createObjectStore(STORES.cash, { keyPath: "id" });
        s.createIndex("byDate", "createdAt", { unique: false });
        s.createIndex("byType", "type", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.stockMoves)) {
        const s = db.createObjectStore(STORES.stockMoves, { keyPath: "id" });
        s.createIndex("byDate", "createdAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}

export const dbApi = {
  async getAll(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = tx(db, store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async get(store, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = tx(db, store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  },

  async put(store, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = tx(db, store, "readwrite").put(value);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  async bulkPut(store, values) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, "readwrite");
      const s = t.objectStore(store);
      for (const v of values) s.put(v);
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  },

  async del(store, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = tx(db, store, "readwrite").delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  async clear(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = tx(db, store, "readwrite").clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  STORES,
};
