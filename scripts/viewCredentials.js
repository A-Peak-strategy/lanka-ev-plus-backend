import { readFileSync } from "fs";

/**
 * Display seed credentials in a formatted, readable way
 * 
 * Usage: node scripts/viewCredentials.js
 */

function formatCredentials() {
  try {
    const fileContent = readFileSync("SEED_CREDENTIALS.json", "utf8");
    const credentials = JSON.parse(fileContent);

    console.log("\n" + "=".repeat(80));
    console.log("🔐 SEEDED DATABASE CREDENTIALS");
    console.log("=".repeat(80));
    console.log(`Generated: ${credentials.generatedAt}`);
    console.log(credentials.note);
    console.log("=".repeat(80));

    // Admin
    console.log("\n👤 ADMIN USER");
    console.log("-".repeat(80));
    console.log(`Email:       ${credentials.admin.email}`);
    console.log(`Password:    ${credentials.admin.password}`);
    console.log(`Firebase UID: ${credentials.admin.firebaseUid}`);
    console.log(`User ID:     ${credentials.admin.userId}`);
    console.log(`Role:        ${credentials.admin.role}`);

    // Owners
    console.log("\n" + "=".repeat(80));
    console.log("🏢 OWNER USERS (8)");
    console.log("=".repeat(80));
    credentials.owners.forEach((owner, index) => {
      console.log(`\nOwner ${index + 1}:`);
      console.log(`  Name:        ${owner.name}`);
      console.log(`  Email:       ${owner.email}`);
      console.log(`  Password:    ${owner.password}`);
      console.log(`  Firebase UID: ${owner.firebaseUid}`);
      console.log(`  User ID:     ${owner.userId}`);
    });

    // Consumers
    console.log("\n" + "=".repeat(80));
    console.log("👥 CONSUMER USERS (50)");
    console.log("=".repeat(80));
    
    // Show first 10 and last 5
    console.log("\nFirst 10 consumers:");
    credentials.consumers.slice(0, 10).forEach((consumer, index) => {
      console.log(`${String(index + 1).padStart(2)}. ${consumer.email.padEnd(30)} | Password: ${consumer.password.padEnd(15)} | Balance: LKR ${consumer.walletBalance.toFixed(2)}`);
    });

    if (credentials.consumers.length > 10) {
      console.log("\n... (35 more consumers) ...\n");
      console.log("Last 5 consumers:");
      credentials.consumers.slice(-5).forEach((consumer, index) => {
        const actualIndex = credentials.consumers.length - 5 + index;
        console.log(`${String(actualIndex + 1).padStart(2)}. ${consumer.email.padEnd(30)} | Password: ${consumer.password.padEnd(15)} | Balance: LKR ${consumer.walletBalance.toFixed(2)}`);
      });
    }

    // Quick reference table
    console.log("\n" + "=".repeat(80));
    console.log("📋 QUICK REFERENCE TABLE");
    console.log("=".repeat(80));
    console.log("\nAll Consumer Credentials:");
    console.log("─".repeat(80));
    console.log("Email".padEnd(30) + " | Password".padEnd(15) + " | Balance");
    console.log("─".repeat(80));
    credentials.consumers.forEach((consumer) => {
      console.log(
        consumer.email.padEnd(30) + 
        " | " + 
        consumer.password.padEnd(15) + 
        " | LKR " + 
        consumer.walletBalance.toFixed(2)
      );
    });

    // Summary
    console.log("\n" + "=".repeat(80));
    console.log("📊 SUMMARY");
    console.log("=".repeat(80));
    console.log(`Total Users:      ${1 + credentials.owners.length + credentials.consumers.length}`);
    console.log(`  - Admin:       1`);
    console.log(`  - Owners:      ${credentials.owners.length}`);
    console.log(`  - Consumers:   ${credentials.consumers.length}`);
    
    const totalBalance = credentials.consumers.reduce((sum, c) => sum + c.walletBalance, 0);
    console.log(`Total Wallet Balance: LKR ${totalBalance.toFixed(2)}`);
    console.log(`Average Wallet Balance: LKR ${(totalBalance / credentials.consumers.length).toFixed(2)}`);
    console.log("=".repeat(80));
    
    console.log("\n💡 TIP: To create these users in Firebase, run:");
    console.log("   node scripts/createFirebaseUsers.js");
    console.log("\n");

  } catch (error) {
    console.error("❌ Failed to read credentials file:", error.message);
    console.error("   Please run 'npm run db:seed' first to generate credentials");
    process.exit(1);
  }
}

formatCredentials();

