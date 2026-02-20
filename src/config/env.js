/**
 * Environment variable validation
 * Validates required environment variables at startup and fails fast if missing.
 */

const required = [
  "DATABASE_URL",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "REDIS_URL",
];

const optional = {
  PORT: "7070",
  CORS_ORIGIN: "",
  PAYHERE_MERCHANT_ID: "",
  PAYHERE_MERCHANT_SECRET: "",
  PAYHERE_SANDBOX: "true",
  APP_URL: "http://localhost:3000",
  FRONTEND_URL: "http://localhost:3000",
  RETURN_URL: "http://localhost:3000/success",
  CANCEL_URL: "http://localhost:3000/cancel",
  NOTIFY_URL: "",
};

export function validateEnv() {
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error("\nPlease set them in your .env file and restart.");
    process.exit(1);
  }

  // Set defaults for optional vars
  for (const [key, defaultValue] of Object.entries(optional)) {
    if (!process.env[key]) {
      process.env[key] = defaultValue;
    }
  }

  console.log("✅ Environment variables validated");
}

export default { validateEnv };
