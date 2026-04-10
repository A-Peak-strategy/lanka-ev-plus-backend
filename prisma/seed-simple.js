import { PrismaClient } from "@prisma/client";
import fs from "fs";

const prisma = new PrismaClient();

function uid() {
    const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return Array.from({ length: 28 }, () => c[Math.floor(Math.random() * c.length)]).join("");
}

async function main() {
    console.log("🌱 Starting simple seed...\n");

    // Clean everything
    const tables = [
        "chargingSessionLive", "ledger", "settlementItem", "wallet", "booking",
        "chargingSession", "gracePeriodJob", "connector", "chargerRuntimeState",
        "settlement", "charger", "station", "pricing", "payment",
        "adminAuditLog", "ocppMessageLog", "user",
    ];
    for (const t of tables) {
        await prisma[t]?.deleteMany().catch(() => { });
    }

    const creds = [];

    // ── Pricing ──
    const pricing = await prisma.pricing.create({
        data: {
            name: "Standard Rate",
            pricePerKwh: 50.0,
            commissionRate: 2.0,
            gracePeriodSec: 60,
            lowBalanceThreshold: 100.0,
            isDefault: true,
        },
    });
    console.log("💰 Pricing: Standard Rate (LKR 50/kWh)");

    // ── 1 Admin ──
    const adminUid = uid();
    const admin = await prisma.user.create({
        data: {
            firebaseUid: adminUid,
            ocppIdTag: `ADM-${adminUid.slice(0, 8)}`,
            email: "admin@echarge.com",
            name: "System Admin",
            role: "ADMIN",
        },
    });
    creds.push({ role: "ADMIN", email: admin.email, password: "Admin@123", firebaseUid: adminUid, userId: admin.id });
    console.log(`👤 Admin: ${admin.email}`);

    // ── 5 Owners ──
    const ownerNames = ["Colombo Stations", "Kandy EV", "Galle Charging", "Negombo Hub", "Jaffna Power"];
    const owners = [];
    for (let i = 0; i < 5; i++) {
        const fuid = uid();
        const owner = await prisma.user.create({
            data: {
                firebaseUid: fuid,
                ocppIdTag: `OWN-${fuid.slice(0, 8)}`,
                email: `owner${i + 1}@stations.com`,
                name: ownerNames[i],
                phone: `+9477${String(1000000 + i).padStart(7, "0")}`,
                role: "OWNER",
            },
        });
        owners.push(owner);
        creds.push({ role: "OWNER", email: owner.email, password: `Owner${i + 1}@123`, firebaseUid: fuid, userId: owner.id, name: owner.name });
    }
    console.log(`🏢 Owners: ${owners.length}`);

    // ── 10 Consumers with wallets ──
    const names = ["Kamal", "Nimal", "Priya", "Samantha", "Dilshan", "Anjali", "Pawan", "Hiruni", "Ravindu", "Tharushi"];
    const consumers = [];
    for (let i = 0; i < 10; i++) {
        const fuid = uid();
        const bal = Math.floor(Math.random() * 4000) + 1000;
        const consumer = await prisma.user.create({
            data: {
                firebaseUid: fuid,
                ocppIdTag: `USR-${fuid.slice(0, 8)}`,
                email: `user${i + 1}@example.com`,
                name: `${names[i]} Perera`,
                phone: `+9477${String(2000000 + i).padStart(7, "0")}`,
                role: "CONSUMER",
                wallet: { create: { balance: bal, currency: "LKR" } },
            },
            include: { wallet: true },
        });
        consumers.push(consumer);
        creds.push({ role: "CONSUMER", email: consumer.email, password: `User${String(i + 1).padStart(2, "0")}@123`, firebaseUid: fuid, userId: consumer.id, name: consumer.name, walletBalance: bal });
    }
    console.log(`👥 Consumers: ${consumers.length} (with wallets)`);

    // ── 5 Stations (1 per owner) ──
    const stationData = [
        { name: "Colombo Fort Central", addr: "Fort, Colombo 01", lat: 6.9352, lng: 79.8447 },
        { name: "Kandy City Center", addr: "Temple St, Kandy", lat: 7.2906, lng: 80.6337 },
        { name: "Galle Fort Charging", addr: "Fort Area, Galle", lat: 6.0329, lng: 80.2170 },
        { name: "Negombo Airport Hub", addr: "Near BIA, Negombo", lat: 7.1756, lng: 79.8842 },
        { name: "Jaffna Central", addr: "Jaffna Town", lat: 9.6615, lng: 80.0255 },
    ];
    const stations = [];
    for (let i = 0; i < 5; i++) {
        const s = await prisma.station.create({
            data: {
                name: stationData[i].name,
                address: stationData[i].addr,
                latitude: stationData[i].lat,
                longitude: stationData[i].lng,
                ownerId: owners[i].id,
                pricingId: pricing.id,
            },
        });
        stations.push(s);
    }
    console.log(`🏭 Stations: ${stations.length}`);

    // ── 10 Chargers (2 per station) ──
    const models = [
        { vendor: "ABB", model: "Terra AC" },
        { vendor: "Schneider", model: "EVlink" },
        { vendor: "ChargePoint", model: "CPE250" },
        { vendor: "Delta", model: "AC Max" },
        { vendor: "Tesla", model: "Wall Connector" },
    ];
    const chargers = [];
    for (let i = 0; i < 10; i++) {
        const stIdx = Math.floor(i / 2);
        const m = models[i % models.length];
        const charger = await prisma.charger.create({
            data: {
                id: `CP${String(i + 1).padStart(3, "0")}`,
                serialNumber: `SN-${String(i + 1).padStart(6, "0")}`,
                stationId: stations[stIdx].id,
                vendor: m.vendor,
                model: m.model,
                firmwareVersion: "1.0.0",
                status: "AVAILABLE",
                connectionState: "DISCONNECTED",
                isRegistered: true,
                registeredAt: new Date(),
                connectors: {
                    create: [{ connectorId: 1, status: "AVAILABLE" }],
                },
            },
            include: { connectors: true },
        });
        chargers.push(charger);
    }
    console.log(`🔌 Chargers: ${chargers.length} (CP001–CP010)`);

    // ── Save credentials ──
    fs.writeFileSync(
        "SEED_CREDENTIALS.json",
        JSON.stringify({
            generatedAt: new Date().toISOString(),
            note: "Dev/test only. Create these users in Firebase Console.",
            admin: creds.find((c) => c.role === "ADMIN"),
            owners: creds.filter((c) => c.role === "OWNER"),
            consumers: creds.filter((c) => c.role === "CONSUMER"),
        }, null, 2)
    );

    console.log("\n" + "=".repeat(50));
    console.log("✅ SEED COMPLETE");
    console.log("=".repeat(50));
    console.log(`  👤 1 Admin    | 🏢 5 Owners  | 👥 10 Consumers`);
    console.log(`  🏭 5 Stations | 🔌 10 Chargers (CP001–CP010)`);
    console.log(`  💰 Pricing: LKR 50/kWh`);
    console.log("=".repeat(50));
    console.log("\n📄 Credentials → SEED_CREDENTIALS.json");
    console.log("⚠️  Create users in Firebase Console with listed passwords!\n");
}

main()
    .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
