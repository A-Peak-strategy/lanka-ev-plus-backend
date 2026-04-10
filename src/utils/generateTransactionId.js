import prisma from "../config/db.js";

let txCounter = null;

/**
 * Initialize the transaction counter from the database.
 * Must be called once during server startup before any OCPP connections.
 *
 * Queries the highest transactionId in ChargingSession and starts
 * the counter from max + 1, preventing collisions after restarts.
 */
export async function initTransactionCounter() {
  const maxSession = await prisma.chargingSession.findFirst({
    orderBy: { transactionId: "desc" },
    select: { transactionId: true },
  });

  txCounter = (maxSession?.transactionId ?? 0) + 1;
  console.log(`✅ Transaction counter initialized: starting at ${txCounter}`);
}

/**
 * Generate a unique, monotonically increasing transaction ID.
 * Throws if called before initTransactionCounter().
 */
export function generateTransactionId() {
  if (txCounter === null) {
    throw new Error(
      "Transaction counter not initialized. Call initTransactionCounter() on startup."
    );
  }
  return txCounter++;
}