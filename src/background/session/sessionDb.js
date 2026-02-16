// background/session/sessionDb.js — IndexedDB bootstrap for sessions

import { SESSION_DB } from "../../shared/sessionSchema.js";

let dbPromise = null;

export function openSessionDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(SESSION_DB.NAME, SESSION_DB.VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(SESSION_DB.STORE)) {
                    const store = db.createObjectStore(SESSION_DB.STORE, {
                        keyPath: "sessionId",
                    });
                    store.createIndex("problemKey", "problemKey", {
                        unique: false,
                    });
                    store.createIndex("platform", "platform", {
                        unique: false,
                    });
                    store.createIndex("platformProblem", ["platform", "problemId"], {
                        unique: false,
                    });
                    store.createIndex("status", "status", { unique: false });
                    store.createIndex("endTime", "endTime", { unique: false });
                    store.createIndex("lastUpdated", "lastUpdated", {
                        unique: false,
                    });
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
                reject(new Error("IndexedDB open blocked by another connection"));
            };

            request.onerror = () => {
                reject(request.error || new Error("Failed to open sessions DB"));
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
