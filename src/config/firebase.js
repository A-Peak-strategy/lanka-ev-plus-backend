import admin from "firebase-admin";

let firebaseApp = null;

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
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
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

