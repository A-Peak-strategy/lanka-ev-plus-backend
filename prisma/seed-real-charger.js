import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seed only the real charger (CP-REAL-01).
 * Run: npm run db:seed:real-charger
 *
 * OCPP URL: ws://<server>:7070/CP-REAL-01
 * Update id & serialNumber in this file to match your physical charger.
 */
async function main() {
  console.log("🔌 Seeding real charger only...");

  // Use first station if any exists; otherwise null
  const station = await prisma.station.findFirst({ take: 1 });

  const chargerData = {
    id: "CP-REAL-01",
    serialNumber: "REAL-CHARGER-001",
    stationId: station?.id ?? null,
    vendor: "ABB",
    model: "Terra AC",
    firmwareVersion: "1.0.0",
    status: "UNAVAILABLE",
    connectionState: "DISCONNECTED",
    isRegistered: true,
    registeredAt: new Date(),
  };

  const existing = await prisma.charger.findUnique({
    where: { id: chargerData.id },
    include: { connectors: true },
  });

  if (existing) {
    await prisma.charger.update({
      where: { id: chargerData.id },
      data: {
        serialNumber: chargerData.serialNumber,
        stationId: chargerData.stationId,
        vendor: chargerData.vendor,
        model: chargerData.model,
        firmwareVersion: chargerData.firmwareVersion,
        status: chargerData.status,
        connectionState: chargerData.connectionState,
        isRegistered: chargerData.isRegistered,
      },
    });
    console.log(`✅ Updated charger: ${chargerData.id}`);
  } else {
    await prisma.charger.create({
      data: {
        ...chargerData,
        connectors: {
          create: [
            { connectorId: 1, status: "UNAVAILABLE" },
            { connectorId: 2, status: "UNAVAILABLE" },
          ],
        },
      },
    });
    console.log(`✅ Created charger: ${chargerData.id}`);
  }

  console.log(`   OCPP URL: ws://<server>:7070/${chargerData.id}`);
  console.log("");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
