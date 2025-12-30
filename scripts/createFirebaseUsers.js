import "dotenv/config";
import admin from "firebase-admin";
import { readFileSync } from "fs";

/**
 * Script to create Firebase users from seed credentials
 * 
 * Usage: node scripts/createFirebaseUsers.js
 * 
 * Prerequisites:
 * 1. Firebase Admin SDK must be initialized in your .env
 * 2. Seed must be run first to generate SEED_CREDENTIALS.json
 */

// Initialize Firebase Admin
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  
  if (!serviceAccount.projectId) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT not configured");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("✅ Firebase Admin initialized");
} catch (error) {
  console.error("❌ Failed to initialize Firebase Admin:", error.message);
  console.error("\n💡 Make sure FIREBASE_SERVICE_ACCOUNT is set in .env");
  console.error("   Format: FIREBASE_SERVICE_ACCOUNT='{\"projectId\":\"...\",\"privateKey\":\"...\",\"clientEmail\":\"...\"}'");
  process.exit(1);
}

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
    if (error.code === "auth/uid-already-exists") {
      console.log(`⚠️  User ${email} already exists, skipping...`);
      return { success: false, reason: "already-exists", error: error.message };
    }
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("🔥 Starting Firebase user creation...\n");

  // Read credentials file
  let credentials;
  try {
    const fileContent = readFileSync("SEED_CREDENTIALS.json", "utf8");
    credentials = JSON.parse(fileContent);
  } catch (error) {
    console.error("❌ Failed to read SEED_CREDENTIALS.json");
    console.error("   Please run 'npm run db:seed' first to generate credentials");
    process.exit(1);
  }

  const results = {
    admin: { success: 0, failed: 0 },
    owners: { success: 0, failed: 0 },
    consumers: { success: 0, failed: 0 },
  };

  // Create admin
  console.log("👤 Creating admin user...");
  const adminResult = await createFirebaseUser(
    credentials.admin.email,
    credentials.admin.password,
    credentials.admin.firebaseUid,
    credentials.admin.role
  );
  if (adminResult.success) {
    results.admin.success++;
    console.log(`   ✅ ${credentials.admin.email}`);
  } else {
    results.admin.failed++;
    console.log(`   ❌ ${credentials.admin.email}: ${adminResult.error || adminResult.reason}`);
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
    } else {
      results.owners.failed++;
      console.log(`   ❌ ${owner.email}: ${result.error || result.reason}`);
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
    } else {
      results.consumers.failed++;
      if (result.error && !result.reason) {
        console.log(`   ❌ ${consumer.email}: ${result.error}`);
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 SUMMARY");
  console.log("=".repeat(60));
  console.log(`👤 Admin:    ${results.admin.success} created, ${results.admin.failed} failed`);
  console.log(`🏢 Owners:   ${results.owners.success} created, ${results.owners.failed} failed`);
  console.log(`👥 Consumers: ${results.consumers.success} created, ${results.consumers.failed} failed`);
  console.log("=".repeat(60));
  console.log("\n✅ Firebase user creation completed!");
}

main()
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });

