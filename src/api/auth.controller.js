import { sendVerificationCode, verifyCode, EmailVerificationError } from "../services/emailVerification.service.js";

function respondError(res, error) {
  if (error instanceof EmailVerificationError) {
    return res.status(error.status).json({ success: false, message: error.message, code: error.code, ...error.details });
  }
  console.error("[EmailVerification] Unexpected error:", error);
  return res.status(500).json({ success: false, message: "Unable to process email verification" });
}

export async function sendEmailOtp(req, res) {
  try {
    const result = await sendVerificationCode({ firebaseUser: req.firebaseUser, name: req.body?.name, phone: req.body?.phone, ip: req.ip });
    return res.json({ success: true, message: "Verification code sent", ...result });
  } catch (error) { return respondError(res, error); }
}

export async function verifyEmailOtp(req, res) {
  try {
    const result = await verifyCode({ firebaseUser: req.firebaseUser, otp: req.body?.otp });
    return res.json({ success: true, message: "Email verified and account created", ...result });
  } catch (error) { return respondError(res, error); }
}
