import "dotenv/config";
import admin from "firebase-admin";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

/**
 * Script to create Firebase users from seed credentials
 *
 * Usage: node scripts/createFirebaseUsers.js
 *
 * Prerequisites:
 * 1. Firebase service account JSON file must exist
 * 2. Seed must be run first to generate SEED_CREDENTIALS.json
 */

// ============================================
// Find and load Firebase service account JSON
// ============================================
function findServiceAccountFile() {
  // 0. Standard env var (e.g. GOOGLE_APPLICATION_CREDENTIALS)
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (envPath && existsSync(resolve(envPath))) {
    return resolve(envPath);
  }
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  // 1. Check known filenames in backend root
  const knownNames = ["serviceAccountKey.json", "firebase-service-account.json"];
  for (const name of knownNames) {
    const p = resolve(projectRoot, name);
    if (existsSync(p)) return p;
  }

  // 2. Search for *firebase*adminsdk*.json in backend root and parent directory
  const searchDirs = [projectRoot, resolve(projectRoot, "..")];
  for (const dir of searchDirs) {
    try {
      const files = readdirSync(dir);
      const match = files.find(
        (f) => f.endsWith(".json") && f.includes("firebase") && f.includes("adminsdk")
      );
      if (match) return resolve(dir, match);
    } catch {
      // directory not readable, skip
    }
  }

  // 3. Sibling folders (e.g. lanka-ev-app)
  try {
    const parentDir = resolve(projectRoot, "..");
    const siblings = readdirSync(parentDir);
    for (const sibling of siblings) {
      const siblingDir = resolve(parentDir, sibling);
      try {
        const files = readdirSync(siblingDir);
        const match = files.find(
          (f) => f.endsWith(".json") && f.includes("firebase") && f.includes("adminsdk")
        );
        if (match) return resolve(siblingDir, match);
      } catch {
        // not a directory or not readable
      }
    }
  } catch {
    // parent not readable
  }

  return null;
}

// Initialize Firebase Admin
try {
  const saPath = findServiceAccountFile();

  if (!saPath) {
    throw new Error(
      "No Firebase service account JSON file found.\n" +
        "   Place it in the backend root as serviceAccountKey.json"
    );
  }

  const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"));

  if (!serviceAccount.project_id && !serviceAccount.projectId) {
    throw new Error("Invalid service account JSON: missing project_id");
  }
  const projectId = serviceAccount.project_id || serviceAccount.projectId;

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log(`📄 Service account: ${saPath}`);
  console.log(`🔥 Firebase project: ${projectId}`);
  console.log("✅ Firebase Admin initialized");
} catch (error) {
  console.error("❌ Failed to initialize Firebase Admin:", error.message);
  process.exit(1);
}

// ============================================
// Create a single Firebase user
// ============================================
async function createFirebaseUser(email, password, uid, displayName = null) {
  try {
    const userRecord = await admin.auth().createUser({
      uid: uid,
      email: email,
      password: password,
      displayName: displayName,
      emailVerified: true,
    });
    return { success: true, uid: userRecord.uid, email: userRecord.email };
  } catch (error) {
    const code = error.code || error.errorInfo?.code;
    if (code === "auth/uid-already-exists" || code === "auth/email-already-exists") {
      return { success: false, reason: "already-exists", error: error.message };
    }
    return { success: false, error: error.message };
  }
}

/** Validate SEED_CREDENTIALS.json structure */
function validateCredentials(credentials) {
  if (!credentials || typeof credentials !== "object") {
    throw new Error("SEED_CREDENTIALS.json is invalid or empty");
  }
  if (!credentials.admin || !credentials.admin.email || !credentials.admin.password || !credentials.admin.firebaseUid) {
    throw new Error("SEED_CREDENTIALS.json must have admin with email, password, firebaseUid");
  }
  if (!Array.isArray(credentials.owners)) {
    throw new Error("SEED_CREDENTIALS.json must have an owners array");
  }
  if (!Array.isArray(credentials.consumers)) {
    throw new Error("SEED_CREDENTIALS.json must have a consumers array");
  }
}

// ============================================
// Main
// ============================================
async function main() {
  console.log("\n🔥 Starting Firebase user creation...\n");

  // Read and validate credentials file
  const credentialsPath = resolve(projectRoot, "SEED_CREDENTIALS.json");
  if (!existsSync(credentialsPath)) {
    console.error("❌ SEED_CREDENTIALS.json not found in backend root");
    console.error("   Run first: npm run db:seed:users  (or npm run db:seed)");
    process.exit(1);
  }

  let credentials;
  try {
    credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
    validateCredentials(credentials);
  } catch (error) {
    if (error.message && error.message.startsWith("SEED_CREDENTIALS")) {
      console.error("❌", error.message);
    } else {
      console.error("❌ Failed to read SEED_CREDENTIALS.json:", error.message);
      console.error("   Run first: npm run db:seed:users  (or npm run db:seed)");
    }
    process.exit(1);
  }

  const results = {
    admin: { success: 0, skipped: 0, failed: 0 },
    owners: { success: 0, skipped: 0, failed: 0 },
    consumers: { success: 0, skipped: 0, failed: 0 },
  };

  // Create admin
  console.log("👤 Creating admin user...");
  const adminResult = await createFirebaseUser(
    credentials.admin.email,
    credentials.admin.password,
    credentials.admin.firebaseUid,
    "System Administrator"
  );
  if (adminResult.success) {
    results.admin.success++;
    console.log(`   ✅ ${credentials.admin.email}`);
  } else if (adminResult.reason === "already-exists") {
    results.admin.skipped++;
    console.log(`   ⚠️  ${credentials.admin.email} (already exists, skipped)`);
  } else {
    results.admin.failed++;
    console.log(`   ❌ ${credentials.admin.email}: ${adminResult.error}`);
  }

  // Create owners
  console.log("\n🏢 Creating owner users...");
  for (const owner of credentials.owners) {
    const result = await createFirebaseUser(
      owner.email,
      owner.password,
      owner.firebaseUid,
      owner.name
    );
    if (result.success) {
      results.owners.success++;
      console.log(`   ✅ ${owner.email} - ${owner.name}`);
    } else if (result.reason === "already-exists") {
      results.owners.skipped++;
      console.log(`   ⚠️  ${owner.email} (already exists, skipped)`);
    } else {
      results.owners.failed++;
      console.log(`   ❌ ${owner.email}: ${result.error}`);
    }
  }

  // Create consumers
  console.log("\n👥 Creating consumer users...");
  for (let i = 0; i < credentials.consumers.length; i++) {
    const consumer = credentials.consumers[i];
    const result = await createFirebaseUser(
      consumer.email,
      consumer.password,
      consumer.firebaseUid,
      consumer.name
    );
    if (result.success) {
      results.consumers.success++;
      if ((i + 1) % 10 === 0) {
        console.log(`   ✅ Created ${i + 1}/${credentials.consumers.length} users...`);
      }
    } else if (result.reason === "already-exists") {
      results.consumers.skipped++;
    } else {
      results.consumers.failed++;
      console.log(`   ❌ ${consumer.email}: ${result.error}`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 SUMMARY");
  console.log("=".repeat(60));
  console.log(`👤 Admin:     ${results.admin.success} created, ${results.admin.skipped} skipped, ${results.admin.failed} failed`);
  console.log(`🏢 Owners:    ${results.owners.success} created, ${results.owners.skipped} skipped, ${results.owners.failed} failed`);
  console.log(`👥 Consumers: ${results.consumers.success} created, ${results.consumers.skipped} skipped, ${results.consumers.failed} failed`);
  console.log("=".repeat(60));
  console.log("\n✅ Done!");
}

main().catch((error) => {
  console.error("❌ Script failed:", error);
  process.exit(1);
});
 