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
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "MAIL_FROM",
  "MAIL_FROM_NAME",
  "EMAIL_OTP_PEPPER",
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
  SMTP_SECURE: "false",
  EMAIL_OTP_TTL_SECONDS: "600",
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS: "60",
  EMAIL_OTP_MAX_ATTEMPTS: "5",
  EMAIL_OTP_MAX_SENDS_PER_HOUR: "5",
  UNVERIFIED_ACCOUNT_MAX_AGE_HOURS: "24",
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

  const numericSettings = [
    "SMTP_PORT",
    "EMAIL_OTP_TTL_SECONDS",
    "EMAIL_OTP_RESEND_COOLDOWN_SECONDS",
    "EMAIL_OTP_MAX_ATTEMPTS",
    "EMAIL_OTP_MAX_SENDS_PER_HOUR",
    "UNVERIFIED_ACCOUNT_MAX_AGE_HOURS",
  ];
  for (const key of numericSettings) {
    if (!Number.isInteger(Number(process.env[key])) || Number(process.env[key]) <= 0) {
      console.error(`Invalid positive integer for ${key}`);
      process.exit(1);
    }
  }
  if (process.env.EMAIL_OTP_PEPPER.length < 32) {
    console.error("EMAIL_OTP_PEPPER must be at least 32 characters");
    process.exit(1);
  }

  console.log("✅ Environment variables validated");
}

export default { validateEnv };
