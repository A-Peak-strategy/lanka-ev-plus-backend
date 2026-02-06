import { PrismaClient } from "@prisma/client";
import fs from "fs";

const prisma = new PrismaClient();

/**
 * Generate a mock Firebase UID (28 characters)
 */
function generateFirebaseUid() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let uid = "";
  for (let i = 0; i < 28; i++) {
    uid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return uid;
}

/**
 * Generate a unique Sri Lankan phone number
 */
function createPhoneGenerator() {
  const usedPhones = new Set();
  return function generateUniquePhone() {
    let phone;
    do {
      const base = 770000000 + Math.floor(Math.random() * 9999999);
      phone = `+94${base}`;
    } while (usedPhones.has(phone) || phone.length !== 12);
    usedPhones.add(phone);
    return phone;
  };
}

/**
 * Seed ONLY users (admin, owners, consumers with wallets)
 */
async function main() {
  console.log("🌱 Starting USERS-ONLY seed...\n");

  // Clear existing user-related data (respecting foreign keys)
  console.log("🗑️  Clearing existing user-related data...");

  await prisma.ledger.deleteMany().catch(() => {});
  await prisma.wallet.deleteMany().catch(() => {});
  await prisma.booking.deleteMany().catch(() => {});
  await prisma.payment.deleteMany().catch(() => {});
  await prisma.chargingSession.deleteMany().catch(() => {});
  await prisma.gracePeriodJob.deleteMany().catch(() => {});
  await prisma.adminAuditLog.deleteMany().catch(() => {});

  // Delete settlement items before settlements
  await prisma.settlementItem.deleteMany().catch(() => {});
  await prisma.settlement.deleteMany().catch(() => {});

  // Delete connectors before chargers, chargers before stations
  await prisma.connector.deleteMany().catch(() => {});
  await prisma.charger.deleteMany().catch(() => {});
  await prisma.station.deleteMany().catch(() => {});

  // Now safe to delete users
  await prisma.user.deleteMany().catch(() => {});

  console.log("✅ Cleared existing data\n");

  const credentials = [];
  const generatePhone = createPhoneGenerator();

  // ============================================
  // 1. CREATE ADMIN USER
  // ============================================
  console.log("👤 Creating admin user...");

  const adminFirebaseUid = generateFirebaseUid();
  const adminPassword = "Admin@123";

  const admin = await prisma.user.create({
    data: {
      firebaseUid: adminFirebaseUid,
      email: "admin@echarge.com",
      name: "System Administrator",
      role: "ADMIN",
      isActive: true,
    },
  });

  credentials.push({
    role: "ADMIN",
    email: admin.email,
    password: adminPassword,
    firebaseUid: adminFirebaseUid,
    userId: admin.id,
  });

  console.log(`   ✅ ${admin.email} (${adminPassword})`);

  // ============================================
  // 2. CREATE 8 OWNER USERS
  // ============================================
  console.log("\n🏢 Creating owner users...");

  const ownerNames = [
    "Colombo City Stations",
    "Kandy EV Network",
    "Galle Coast Charging",
    "Negombo Express",
    "Jaffna Northern Power",
    "Matara South Charge",
    "Anuradhapura Heritage",
    "Ratnapura Gem Stations",
  ];

  for (let i = 0; i < 8; i++) {
    const firebaseUid = generateFirebaseUid();
    const password = `Owner${i + 1}@123`;
    const phone = generatePhone();

    const owner = await prisma.user.create({
      data: {
        firebaseUid: firebaseUid,
        email: `owner${i + 1}@stations.com`,
        name: ownerNames[i],
        phone: phone,
        role: "OWNER",
        isActive: true,
      },
    });

    credentials.push({
      role: "OWNER",
      email: owner.email,
      password: password,
      firebaseUid: firebaseUid,
      userId: owner.id,
      name: owner.name,
    });

    console.log(`   ✅ ${owner.email} (${password}) - ${owner.name}`);
  }

  // ============================================
  // 3. CREATE 50 CONSUMER USERS WITH WALLETS
  // ============================================
  console.log("\n👥 Creating consumer users with wallets...");

  const firstNames = [
    "Kamal", "Nimal", "Sunil", "Priya", "Samantha", "Chaminda", "Dilshan", "Kavindu",
    "Anjali", "Tharushi", "Ishan", "Sanduni", "Pawan", "Dilan", "Hiruni", "Minoli",
    "Pasindu", "Yasara", "Ravindu", "Ishara", "Tharaka", "Achintha", "Udara", "Kaveesha",
    "Nimesh", "Shanika", "Dulani", "Nishan", "Ruwani", "Ashen", "Dhanushka", "Lahiru",
    "Chathura", "Nadeesh", "Sahan", "Randika", "Imesh", "Umesh", "Lakshitha", "Nuwan",
    "Dinesh", "Thushara", "Chathurika", "Gayan", "Prasad", "Niroshan", "Chamara",
    "Dilrukshi", "Charith", "Sachini",
  ];

  const lastNames = [
    "Perera", "Fernando", "Silva", "De Silva", "Wijesekara", "Jayawardena", "Bandara",
    "Karunaratne", "Rajapaksa", "Wickramasinghe", "Amarasinghe", "Gunasekara", "Abeywickrama",
    "Ratnayake", "Dissanayake", "Weerasekara", "Jayasekara", "Perera", "Wijetunga", "Kumarasiri",
  ];

  for (let i = 0; i < 50; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[Math.floor(i / firstNames.length) % lastNames.length];
    const fullName = `${firstName} ${lastName}`;
    const firebaseUid = generateFirebaseUid();
    const password = `User${String(i + 1).padStart(2, "0")}@123`;
    const balance = Math.floor(Math.random() * 4500) + 500;
    const phone = generatePhone();

    const consumer = await prisma.user.create({
      data: {
        firebaseUid: firebaseUid,
        email: `user${i + 1}@example.com`,
        name: fullName,
        phone: phone,
        role: "CONSUMER",
        isActive: true,
        wallet: {
          create: {
            balance: balance,
            currency: "LKR",
            version: 0,
          },
        },
      },
      include: {
        wallet: true,
      },
    });

    credentials.push({
      role: "CONSUMER",
      email: consumer.email,
      password: password,
      firebaseUid: firebaseUid,
      userId: consumer.id,
      name: consumer.name,
      walletBalance: balance,
    });
  }

  console.log(`   ✅ Created 50 consumers with wallets`);

  // ============================================
  // GENERATE CREDENTIALS DOCUMENT
  // ============================================
  const credentialsDoc = {
    generatedAt: new Date().toISOString(),
    note: "These credentials are for development/testing only. Create these users in Firebase Console or via Firebase Admin SDK.",
    admin: credentials.find((c) => c.role === "ADMIN"),
    owners: credentials.filter((c) => c.role === "OWNER"),
    consumers: credentials.filter((c) => c.role === "CONSUMER"),
  };

  fs.writeFileSync(
    "SEED_CREDENTIALS.json",
    JSON.stringify(credentialsDoc, null, 2)
  );

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("✅ USERS-ONLY SEED COMPLETED");
  console.log("=".repeat(50));
  console.log(`👤 Admin:       1 user`);
  console.log(`🏢 Owners:      8 users`);
  console.log(`👥 Consumers:   50 users (with wallets)`);
  console.log("=".repeat(50));
  console.log("\n📄 Credentials saved to: SEED_CREDENTIALS.json");
  console.log("\n⚠️  IMPORTANT: Create these users in Firebase Console!");
  console.log("   Use: npm run db:seed:firebase");
  console.log("\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
