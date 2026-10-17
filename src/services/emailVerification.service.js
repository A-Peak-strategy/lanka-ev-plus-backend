import crypto from "crypto";
import admin from "../config/firebase.js";
import prisma from "../config/db.js";
import { getRedis } from "../config/redis.js";
import { sendSignupOtp } from "./mail.service.js";

const ttl = () => Number(process.env.EMAIL_OTP_TTL_SECONDS || 600);
const cooldown = () => Number(process.env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS || 60);
const maxAttempts = () => Number(process.env.EMAIL_OTP_MAX_ATTEMPTS || 5);
const maxSends = () => Number(process.env.EMAIL_OTP_MAX_SENDS_PER_HOUR || 5);
const keyFor = (uid) => `signup:email-otp:${uid}`;
const profileKeyFor = (uid) => `signup:email-otp:profile:${uid}`;

export class EmailVerificationError extends Error {
  constructor(message, status = 400, code = "VERIFICATION_ERROR", details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeEmail(email) { return String(email || "").trim().toLowerCase(); }
function normalizePhone(phone) { return String(phone || "").trim().replace(/[\s().-]/g, ""); }
function cleanName(name) { return String(name || "").trim().replace(/\s+/g, " "); }
function digest(uid, challengeId, otp) {
  return crypto.createHmac("sha256", process.env.EMAIL_OTP_PEPPER)
    .update(`${uid}:${challengeId}:${otp}`).digest("hex");
}
function safeEqual(a, b) {
  const left = Buffer.from(a || "", "hex"); const right = Buffer.from(b || "", "hex");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
function clientIpHash(ip) {
  return crypto.createHmac("sha256", process.env.EMAIL_OTP_PEPPER).update(String(ip || "unknown")).digest("hex").slice(0, 24);
}
function identityHash(value) {
  return crypto.createHmac("sha256", process.env.EMAIL_OTP_PEPPER).update(String(value)).digest("hex").slice(0, 24);
}

async function enforceSendLimits(redis, uid, email, ip) {
  const cooldownKey = `signup:email-otp:cooldown:${uid}`;
  const acquired = await redis.set(cooldownKey, "1", "EX", cooldown(), "NX");
  if (!acquired) {
    const retryAfter = Math.max(await redis.ttl(cooldownKey), 1);
    throw new EmailVerificationError("Please wait before requesting another code", 429, "RESEND_COOLDOWN", { retryAfter });
  }
  const buckets = [`signup:email-otp:hour:uid:${uid}`, `signup:email-otp:hour:email:${identityHash(email)}`, `signup:email-otp:hour:ip:${clientIpHash(ip)}`];
  for (const key of buckets) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
    if (count > maxSends()) {
      await redis.del(cooldownKey);
      throw new EmailVerificationError("Too many verification emails requested", 429, "SEND_LIMIT", { retryAfter: Math.max(await redis.ttl(key), 1) });
    }
  }
  return cooldownKey;
}

export async function sendVerificationCode({ firebaseUser, name, phone, ip }) {
  const firebaseRecord = await admin.auth().getUser(firebaseUser.uid);
  const email = normalizeEmail(firebaseRecord.email);
  if (!email) throw new EmailVerificationError("A Firebase email account is required", 400, "EMAIL_REQUIRED");
  if (firebaseRecord.emailVerified) throw new EmailVerificationError("Email is already verified", 409, "ALREADY_VERIFIED");

  const redis = getRedis();
  let savedProfile = {};
  const savedProfileRaw = await redis.get(profileKeyFor(firebaseUser.uid));
  if (savedProfileRaw) {
    try { savedProfile = JSON.parse(savedProfileRaw); } catch { savedProfile = {}; }
  }
  const safeName = cleanName(name || firebaseRecord.displayName || savedProfile.name);
  const safePhone = normalizePhone(phone || savedProfile.phone);
  if (!safeName || safeName.length > 100) throw new EmailVerificationError("Enter a valid full name", 400, "INVALID_NAME");
  if (!/^\+?[0-9]{7,15}$/.test(safePhone)) throw new EmailVerificationError("Enter a valid phone number", 400, "INVALID_PHONE");

  const [emailUser, phoneUser] = await Promise.all([
    prisma.user.findUnique({ where: { email } }), prisma.user.findUnique({ where: { phone: safePhone } }),
  ]);
  if (emailUser && emailUser.firebaseUid !== firebaseUser.uid) throw new EmailVerificationError("Email is already in use", 409, "EMAIL_IN_USE");
  if (phoneUser && phoneUser.firebaseUid !== firebaseUser.uid) throw new EmailVerificationError("Phone number is already in use", 409, "PHONE_IN_USE");

  const cooldownKey = await enforceSendLimits(redis, firebaseUser.uid, email, ip);
  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const challengeId = crypto.randomUUID();
  const pending = { challengeId, uid: firebaseUser.uid, email, name: safeName, phone: safePhone, hash: digest(firebaseUser.uid, challengeId, otp), attempts: 0, createdAt: Date.now() };
  await redis.set(keyFor(firebaseUser.uid), JSON.stringify(pending), "EX", ttl());
  await redis.set(profileKeyFor(firebaseUser.uid), JSON.stringify({ name: safeName, phone: safePhone }), "EX", 86_400);
  try {
    await sendSignupOtp({ to: email, otp, displayName: safeName, expiresInMinutes: Math.ceil(ttl() / 60) });
  } catch (error) {
    await Promise.all([redis.del(keyFor(firebaseUser.uid)), redis.del(cooldownKey)]);
    console.error(`[EmailVerification] SMTP send failed request=${challengeId} code=${error.code || "unknown"}`);
    throw new EmailVerificationError("Verification email is temporarily unavailable", 503, "SMTP_UNAVAILABLE");
  }
  return { expiresIn: ttl(), resendAfter: cooldown() };
}

async function createApplicationAccount(pending) {
  return prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { firebaseUid: pending.uid } });
    if (!user) {
      const conflict = await tx.user.findFirst({ where: { OR: [{ email: pending.email }, { phone: pending.phone }] } });
      if (conflict) throw new EmailVerificationError("Email or phone number is already in use", 409, "ACCOUNT_CONFLICT");
      user = await tx.user.create({ data: {
        firebaseUid: pending.uid, email: pending.email, phone: pending.phone, name: pending.name,
        role: "CONSUMER", ocppIdTag: `U${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
      } });
    }
    await tx.wallet.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, balance: 0, currency: "LKR" } });
    return user;
  });
}

export async function verifyCode({ firebaseUser, otp }) {
  if (!/^\d{6}$/.test(String(otp || ""))) throw new EmailVerificationError("Enter the 6-digit verification code", 400, "INVALID_FORMAT");
  const [firebaseRecord, existingUser] = await Promise.all([
    admin.auth().getUser(firebaseUser.uid),
    prisma.user.findUnique({ where: { firebaseUid: firebaseUser.uid }, select: { id: true } }),
  ]);
  // A lost success response may cause the client to retry with the same code.
  // Treat a fully finalized account as success without reprocessing the OTP.
  if (firebaseRecord.emailVerified && existingUser) return { userId: existingUser.id };
  const redis = getRedis();
  const raw = await redis.get(keyFor(firebaseUser.uid));
  if (!raw) throw new EmailVerificationError("Verification code has expired. Request a new code", 410, "CODE_EXPIRED");
  const pending = JSON.parse(raw);
  if (pending.uid !== firebaseUser.uid || pending.email !== normalizeEmail(firebaseUser.email)) throw new EmailVerificationError("Verification session is invalid", 401, "SESSION_MISMATCH");
  if (pending.attempts >= maxAttempts()) throw new EmailVerificationError("Too many incorrect attempts. Request a new code", 429, "ATTEMPTS_EXCEEDED");
  if (!safeEqual(pending.hash, digest(pending.uid, pending.challengeId, String(otp)))) {
    const attempts = Number(await redis.eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then return -1 end
      local value = cjson.decode(raw)
      if value.challengeId ~= ARGV[1] then return -1 end
      value.attempts = (value.attempts or 0) + 1
      if value.attempts >= tonumber(ARGV[2]) then
        redis.call('DEL', KEYS[1])
      else
        local remaining = redis.call('TTL', KEYS[1])
        redis.call('SET', KEYS[1], cjson.encode(value), 'EX', math.max(remaining, 1))
      end
      return value.attempts
    `, 1, keyFor(firebaseUser.uid), pending.challengeId, String(maxAttempts())));
    if (attempts < 0) throw new EmailVerificationError("Verification code has expired. Request a new code", 410, "CODE_EXPIRED");
    if (attempts >= maxAttempts()) throw new EmailVerificationError("Too many incorrect attempts. Request a new code", 429, "ATTEMPTS_EXCEEDED");
    throw new EmailVerificationError("The verification code is incorrect", 422, "INCORRECT_CODE", { attemptsRemaining: maxAttempts() - attempts });
  }

  const lockKey = `signup:email-otp:verify-lock:${firebaseUser.uid}`;
  const lockToken = crypto.randomUUID();
  const locked = await redis.set(lockKey, lockToken, "EX", 30, "NX");
  if (!locked) throw new EmailVerificationError("Verification is already being processed", 409, "VERIFICATION_IN_PROGRESS");
  try {
    const latestRaw = await redis.get(keyFor(firebaseUser.uid));
    if (!latestRaw || JSON.parse(latestRaw).challengeId !== pending.challengeId) {
      throw new EmailVerificationError("Verification code has expired. Request a new code", 410, "CODE_EXPIRED");
    }
    await admin.auth().updateUser(firebaseUser.uid, { emailVerified: true });
    const user = await createApplicationAccount(pending);
    await redis.del(keyFor(firebaseUser.uid));
    await redis.del(profileKeyFor(firebaseUser.uid));
    return { userId: user.id };
  } finally {
    await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, lockKey, lockToken);
  }
}

export default { sendVerificationCode, verifyCode };
