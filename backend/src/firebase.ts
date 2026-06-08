import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { config } from "./config.js";

if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: config.projectId,
  });
}

export const auth = getAuth();
export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

