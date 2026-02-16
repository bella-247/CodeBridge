// background/session/sessionDb.js — IndexedDB bootstrap for sessions

import { SESSION_DB } from "../../shared/sessionSchema.js";

let dbPromise = null;

export function openSessionDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(SESSION_DB.NAME, SESSION_DB.VERSION);

            request.onupgradeneeded = (event) => {
                const db = request.result;
                const oldVersion = event.oldVersion || 0;
                const tx = request.transaction;
                if (!tx) return;

                let store = null;
                if (!db.objectStoreNames.contains(SESSION_DB.STORE)) {
                    store = db.createObjectStore(SESSION_DB.STORE, {
                        keyPath: "sessionId",
                    });
                } else {
                    store = tx.objectStore(SESSION_DB.STORE);
                }

                if (!store) return;

                const ensureIndex = (name, keyPath) => {
                    if (!store.indexNames.contains(name)) {
                        store.createIndex(name, keyPath, { unique: false });
                    }
                };

                if (oldVersion < 1) {
                    ensureIndex("problemKey", "problemKey");
                    ensureIndex("platform", "platform");
                    ensureIndex("platformProblem", ["platform", "problemId"]);
                    ensureIndex("status", "status");
                    ensureIndex("endTime", "endTime");
                    ensureIndex("lastUpdated", "lastUpdated");
                }
            };

            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    dbPromise = null;
                    db.close();
                };
                resolve(db);
            };

            request.onblocked = () => {
                dbPromise = null;
                reject(
                    new Error("IndexedDB open blocked by another connection"),
                );
            };

            request.onerror = () => {
                reject(
                    request.error || new Error("Failed to open sessions DB"),
                );
            };
        } catch (err) {
            reject(err);
        }
    }).catch((err) => {
        dbPromise = null;
        throw err;
    });

    return dbPromise;
}
