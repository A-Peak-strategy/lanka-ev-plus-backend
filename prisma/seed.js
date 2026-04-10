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
 * Seed database with dummy data
 */
async function main() {
  console.log("🌱 Starting database seed...");

  // Clear existing data (optional - comment out if you want to keep existing data)
  console.log("🗑️  Clearing existing data...");
  
  // Delete in correct order (respecting foreign keys)
  const deleteOperations = [
    () => prisma.ledger.deleteMany().catch(() => {}),
    () => prisma.settlementItem.deleteMany().catch(() => {}),
    () => prisma.wallet.deleteMany().catch(() => {}),
    () => prisma.booking.deleteMany().catch(() => {}),
    () => prisma.chargingSession.deleteMany().catch(() => {}),
    () => prisma.gracePeriodJob.deleteMany().catch(() => {}),
    () => prisma.connector.deleteMany().catch(() => {}),
    () => prisma.settlement.deleteMany().catch(() => {}),
    () => prisma.station.deleteMany().catch(() => {}),
    () => prisma.charger.deleteMany().catch(() => {}),
    () => prisma.pricing.deleteMany().catch(() => {}),
    () => prisma.adminAuditLog.deleteMany().catch(() => {}),
    () => prisma.ocppMessageLog.deleteMany().catch(() => {}),
    () => prisma.user.deleteMany().catch(() => {}),
  ];
  
  await Promise.all(deleteOperations.map(op => op()));

  // Store credentials for output
  const credentials = [];

  // ============================================
  // 1. CREATE PRICING PLANS
  // ============================================
  console.log("💰 Creating pricing plans...");
  
  const standardPricing = await prisma.pricing.create({
    data: {
      name: "Standard Rate",
      pricePerKwh: 50.00,
      commissionRate: 2.00,
      gracePeriodSec: 60,
      lowBalanceThreshold: 100.00,
      isDefault: true,
      isActive: true,
    },
  });

  const premiumPricing = await prisma.pricing.create({
    data: {
      name: "Premium Rate",
      pricePerKwh: 65.00,
      commissionRate: 2.00,
      gracePeriodSec: 90,
      lowBalanceThreshold: 150.00,
      isDefault: false,
      isActive: true,
    },
  });

  const economyPricing = await prisma.pricing.create({
    data: {
      name: "Economy Rate",
      pricePerKwh: 40.00,
      commissionRate: 2.00,
      gracePeriodSec: 45,
      lowBalanceThreshold: 75.00,
      isDefault: false,
      isActive: true,
    },
  });

  console.log(`✅ Created 3 pricing plans`);

  // ============================================
  // 2. CREATE ADMIN USER
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
      ocppIdTag: `ADMIN-${adminFirebaseUid.slice(0, 8)}`,
    },
  });

  credentials.push({
    role: "ADMIN",
    email: admin.email,
    password: adminPassword,
    firebaseUid: adminFirebaseUid,
    userId: admin.id,
  });

  console.log(`✅ Created admin: ${admin.email}`);

  // ============================================
  // 3. CREATE 8 OWNER USERS
  // ============================================
  console.log("🏢 Creating owner users...");
  
  const owners = [];
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

  const ownerPasswords = [
    "Owner1@123",
    "Owner2@123",
    "Owner3@123",
    "Owner4@123",
    "Owner5@123",
    "Owner6@123",
    "Owner7@123",
    "Owner8@123",
  ];

  // Generate unique phone numbers for owners
  const ownerUsedPhones = new Set();
  function generateUniqueOwnerPhone() {
    let phone;
    do {
      const base = 770000000 + Math.floor(Math.random() * 9999999);
      phone = `+94${base}`;
    } while (ownerUsedPhones.has(phone) || phone.length !== 12);
    ownerUsedPhones.add(phone);
    return phone;
  }

  for (let i = 0; i < 8; i++) {
    const firebaseUid = generateFirebaseUid();
    const phone = generateUniqueOwnerPhone();
    const owner = await prisma.user.create({
      data: {
        firebaseUid: firebaseUid,
        email: `owner${i + 1}@stations.com`,
        name: ownerNames[i],
        phone: phone,
        role: "OWNER",
        isActive: true,
        ocppIdTag: `OWNER-${firebaseUid.slice(0, 8)}`,
      },
    });

    owners.push(owner);
    credentials.push({
      role: "OWNER",
      email: owner.email,
      password: ownerPasswords[i],
      firebaseUid: firebaseUid,
      userId: owner.id,
      name: owner.name,
    });
  }

  console.log(`✅ Created ${owners.length} owners`);

  // ============================================
  // 4. CREATE 50 CONSUMER USERS WITH WALLETS
  // ============================================
  console.log("👥 Creating consumer users with wallets...");

  const consumers = [];
  const firstNames = [
    "Kamal", "Nimal", "Sunil", "Priya", "Samantha", "Chaminda", "Dilshan", "Kavindu",
    "Anjali", "Tharushi", "Ishan", "Sanduni", "Pawan", "Dilan", "Hiruni", "Minoli",
    "Pasindu", "Yasara", "Ravindu", "Ishara", "Tharaka", "Achintha", "Udara", "Kaveesha",
    "Nimesh", "Shanika", "Dulani", "Nishan", "Ruwani", "Ashen", "Dhanushka", "Lahiru",
    "Chathura", "Nadeesh", "Sahan", "Randika", "Imesh", "Umesh", "Lakshitha", "Nuwan",
    "Dinesh", "Thushara", "Chathurika", "Gayan", "Prasad", "Niroshan", "Chamara",
    "Dilrukshi", "Charith", "Sachini", "Dhananjaya"
  ];

  const lastNames = [
    "Perera", "Fernando", "Silva", "De Silva", "Wijesekara", "Jayawardena", "Bandara",
    "Karunaratne", "Rajapaksa", "Wickramasinghe", "Amarasinghe", "Gunasekara", "Abeywickrama",
    "Ratnayake", "Dissanayake", "Weerasekara", "Jayasekara", "Perera", "Wijetunga", "Kumarasiri"
  ];

  const consumerPasswords = Array.from({ length: 50 }, (_, i) => `User${String(i + 1).padStart(2, "0")}@123`);

  // Wallet balances (random between 500 and 5000 LKR)
  const walletBalances = Array.from({ length: 50 }, () => 
    Math.floor(Math.random() * 4500) + 500
  );

  // Generate unique phone numbers
  const usedPhones = new Set();
  function generateUniquePhone() {
    let phone;
    do {
      const base = 770000000 + Math.floor(Math.random() * 9999999);
      phone = `+94${base}`;
    } while (usedPhones.has(phone) || phone.length !== 12);
    usedPhones.add(phone);
    return phone;
  }

  for (let i = 0; i < 50; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[Math.floor(i / firstNames.length) % lastNames.length];
    const fullName = `${firstName} ${lastName}`;
    const firebaseUid = generateFirebaseUid();
    const balance = walletBalances[i];
    const phone = generateUniquePhone();

    const consumer = await prisma.user.create({
      data: {
        firebaseUid: firebaseUid,
        email: `user${i + 1}@example.com`,
        name: fullName,
        phone: phone,
        role: "CONSUMER",
        isActive: true,
        ocppIdTag: `CONSUMER-${firebaseUid.slice(0, 8)}`,
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

    consumers.push(consumer);
    credentials.push({
      role: "CONSUMER",
      email: consumer.email,
      password: consumerPasswords[i],
      firebaseUid: firebaseUid,
      userId: consumer.id,
      name: consumer.name,
      walletBalance: balance,
    });
  }

  console.log(`✅ Created ${consumers.length} consumers with wallets`);

  // ============================================
  // 5. CREATE 10 STATIONS (distributed among owners)
  // ============================================
  console.log("🏭 Creating charging stations...");

  const stationData = [
    {
      name: "Colombo Fort Central",
      address: "Fort, Colombo 01",
      latitude: 6.9352,
      longitude: 79.8447,
      ownerIndex: 0,
      pricingId: standardPricing.id,
    },
    {
      name: "Bambalapitiya Station",
      address: "Galle Road, Colombo 04",
      latitude: 6.8847,
      longitude: 79.8575,
      ownerIndex: 0,
      pricingId: standardPricing.id,
    },
    {
      name: "Kandy City Center",
      address: "Temple Street, Kandy",
      latitude: 7.2906,
      longitude: 80.6337,
      ownerIndex: 1,
      pricingId: premiumPricing.id,
    },
    {
      name: "Kandy Railway Station",
      address: "Railway Station Road, Kandy",
      latitude: 7.2900,
      longitude: 80.6300,
      ownerIndex: 1,
      pricingId: standardPricing.id,
    },
    {
      name: "Galle Fort Charging",
      address: "Fort Area, Galle",
      latitude: 6.0329,
      longitude: 80.2170,
      ownerIndex: 2,
      pricingId: premiumPricing.id,
    },
    {
      name: "Negombo Airport Hub",
      address: "Near BIA, Negombo",
      latitude: 7.1756,
      longitude: 79.8842,
      ownerIndex: 3,
      pricingId: standardPricing.id,
    },
    {
      name: "Jaffna Central",
      address: "Jaffna Town",
      latitude: 9.6615,
      longitude: 80.0255,
      ownerIndex: 4,
      pricingId: economyPricing.id,
    },
    {
      name: "Matara Beach Station",
      address: "Beach Road, Matara",
      latitude: 5.9549,
      longitude: 80.5549,
      ownerIndex: 5,
      pricingId: standardPricing.id,
    },
    {
      name: "Anuradhapura Sacred",
      address: "Near Temple, Anuradhapura",
      latitude: 8.3114,
      longitude: 80.4037,
      ownerIndex: 6,
      pricingId: economyPricing.id,
    },
    {
      name: "Ratnapura Gem City",
      address: "Main Street, Ratnapura",
      latitude: 6.6828,
      longitude: 80.4012,
      ownerIndex: 7,
      pricingId: standardPricing.id,
    },
  ];

  const stations = [];
  for (const data of stationData) {
    const station = await prisma.station.create({
      data: {
        name: data.name,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        ownerId: owners[data.ownerIndex].id,
        pricingId: data.pricingId,
        bookingEnabled: true,
        isActive: true,
      },
    });
    stations.push(station);
  }

  console.log(`✅ Created ${stations.length} stations`);

  // ============================================
  // 6. CREATE CHARGERS (2-4 per station)
  // ============================================
  console.log("🔌 Creating chargers and connectors...");

  const chargerModels = [
    { vendor: "ABB", model: "Terra AC" },
    { vendor: "Schneider", model: "EVlink" },
    { vendor: "Tesla", model: "Supercharger" },
    { vendor: "ChargePoint", model: "CPE250" },
    { vendor: "Delta", model: "AC Max" },
  ];

  let chargerIndex = 0;
  const chargers = [];

  for (let stationIndex = 0; stationIndex < stations.length; stationIndex++) {
    const station = stations[stationIndex];
    const chargerCount = Math.floor(Math.random() * 3) + 2; // 2-4 chargers per station

    for (let i = 0; i < chargerCount; i++) {
      chargerIndex++;
      const chargerModel = chargerModels[Math.floor(Math.random() * chargerModels.length)];
      const serialNumber = `SN-${String(chargerIndex).padStart(6, "0")}`;

      const charger = await prisma.charger.create({
        data: {
          id: `CP${String(chargerIndex).padStart(3, "0")}`,
          serialNumber: serialNumber,
          stationId: station.id,
          vendor: chargerModel.vendor,
          model: chargerModel.model,
          firmwareVersion: `${Math.floor(Math.random() * 3) + 1}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 10)}`,
          status: stationIndex % 3 === 0 ? "AVAILABLE" : stationIndex % 3 === 1 ? "CHARGING" : "UNAVAILABLE",
          connectionState: stationIndex % 4 === 0 ? "DISCONNECTED" : "CONNECTED",
          lastHeartbeat: stationIndex % 4 === 0 ? null : new Date(Date.now() - Math.random() * 3600000),
          isRegistered: true,
          registeredAt: new Date(Date.now() - Math.random() * 30 * 24 * 3600000),
          connectors: {
            create: Array.from({ length: Math.floor(Math.random() * 2) + 1 }, (_, idx) => ({
              connectorId: idx + 1,
              status: "AVAILABLE",
            })),
          },
        },
        include: {
          connectors: true,
        },
      });

      chargers.push(charger);
    }
  }

  // ============================================
  // 6b. CREATE DUMMY CHARGER "chargerone" FOR TESTING
  // ============================================
  const chargerone = await prisma.charger.create({
    data: {
      id: "chargerone",
      serialNumber: "SN-CHARGERONE-001",
      stationId: stations[0].id, // Colombo Fort Central
      vendor: "Dummy",
      model: "Test Charger",
      firmwareVersion: "1.0.0",
      status: "AVAILABLE",
      connectionState: "DISCONNECTED",
      isRegistered: true,
      registeredAt: new Date(),
      connectors: {
        create: [
          { connectorId: 1, status: "AVAILABLE" },
          { connectorId: 2, status: "AVAILABLE" },
        ],
      },
    },
    include: { connectors: true },
  });
  chargers.push(chargerone);

  console.log(`✅ Created ${chargers.length} chargers with connectors (including dummy: chargerone)`);

  // ============================================
  // GENERATE CREDENTIALS DOCUMENT
  // ============================================
  const credentialsDoc = {
    generatedAt: new Date().toISOString(),
    note: "These credentials are for development/testing only. Create these users in Firebase Console or via Firebase Admin SDK.",
    admin: credentials.find(c => c.role === "ADMIN"),
    owners: credentials.filter(c => c.role === "OWNER"),
    consumers: credentials.filter(c => c.role === "CONSUMER"),
  };

  fs.writeFileSync(
    "SEED_CREDENTIALS.json",
    JSON.stringify(credentialsDoc, null, 2)
  );

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("✅ DATABASE SEED COMPLETED");
  console.log("=".repeat(60));
  console.log(`👤 Admin:       1 user`);
  console.log(`🏢 Owners:      8 users`);
  console.log(`👥 Consumers:   50 users`);
  console.log(`🏭 Stations:    10 stations`);
  console.log(`🔌 Chargers:    ${chargers.length} chargers`);
  console.log(`💰 Pricing:     3 plans`);
  console.log("=".repeat(60));
  console.log("\n📄 Credentials saved to: SEED_CREDENTIALS.json");
  console.log("\n⚠️  IMPORTANT: Create these users in Firebase Console!");
  console.log("   You can use Firebase Admin SDK or Firebase Console");
  console.log("   to create users with the emails and passwords listed.");
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

