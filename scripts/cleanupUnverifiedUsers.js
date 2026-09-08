import "dotenv/config";
import admin, { initializeFirebase } from "../src/config/firebase.js";
import prisma from "../src/config/db.js";

const maxAgeMs = Number(process.env.UNVERIFIED_ACCOUNT_MAX_AGE_HOURS || 24) * 60 * 60 * 1000;

async function cleanupPage(pageToken) {
  const result = await admin.auth().listUsers(1000, pageToken);
  let deleted = 0;
  for (const firebaseUser of result.users) {
    const isPasswordUser = firebaseUser.providerData.some((provider) => provider.providerId === "password");
    const createdAt = Date.parse(firebaseUser.metadata.creationTime || "");
    if (!isPasswordUser || firebaseUser.emailVerified || !Number.isFinite(createdAt) || Date.now() - createdAt < maxAgeMs) continue;
    const applicationUser = await prisma.user.findUnique({ where: { firebaseUid: firebaseUser.uid }, select: { id: true } });
    if (!applicationUser) {
      await admin.auth().deleteUser(firebaseUser.uid);
      deleted += 1;
    }
  }
  if (result.pageToken) deleted += await cleanupPage(result.pageToken);
  return deleted;
}

try {
  initializeFirebase();
  const deleted = await cleanupPage();
  console.log(`Removed ${deleted} abandoned unverified Firebase account(s).`);
} catch (error) {
  console.error("Unverified-account cleanup failed:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
