import admin from "firebase-admin";

let firebaseApp = null;

function normalizePrivateKey(value) {
  let key = String(value || "").trim();

  // Accept a private_key value pasted directly from a service-account JSON
  // property, including an accidental trailing comma.
  if (key.endsWith(",")) key = key.slice(0, -1).trimEnd();
  if ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }

  return key.replace(/\\n/g, "\n").trim();
}

function normalizeJsonScalar(value) {
  let normalized = String(value || "").trim();
  if (normalized.endsWith(",")) normalized = normalized.slice(0, -1).trimEnd();
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.trim();
}

/**
 * Initialize Firebase Admin SDK
 * Supports both service account JSON and individual env vars
 */
export const initializeFirebase = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : {
          projectId: normalizeJsonScalar(process.env.FIREBASE_PROJECT_ID),
          clientEmail: normalizeJsonScalar(process.env.FIREBASE_CLIENT_EMAIL),
          privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
        };

    // Validate required fields
    if (!serviceAccount.projectId) {
      console.warn("⚠️ Firebase not configured - notifications disabled");
      return null;
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("✅ Firebase Admin initialized");
    return firebaseApp;
  } catch (error) {
    console.error("❌ Firebase initialization error:", error.message);
    return null;
  }
};

/**
 * Get Firebase Auth instance
 */
export const getAuth = () => {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return firebaseApp ? admin.auth() : null;
};

/**
 * Get Firebase Messaging instance
 */
export const getMessaging = () => {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return firebaseApp ? admin.messaging() : null;
};

export default admin;

