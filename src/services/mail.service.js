import nodemailer from "nodemailer";

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      requireTLS: process.env.SMTP_SECURE !== "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    });
  }
  return transporter;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

export async function sendSignupOtp({ to, otp, displayName, expiresInMinutes }) {
  const safeName = escapeHtml(displayName || "there");
  const subject = "Your Lanka EV Plus verification code";
  const text = `Hello ${displayName || "there"},\n\nYour Lanka EV Plus verification code is ${otp}. It expires in ${expiresInMinutes} minutes.\n\nNever share this code. Lanka EV Plus support will never ask for it. If you did not request this account, ignore this email.`;
  const html = `<!doctype html><html><body style="margin:0;background:#0b1220;font-family:Arial,sans-serif;color:#e5e7eb"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:560px;background:#111b2e;border:1px solid #233452;border-radius:18px"><tr><td style="padding:36px"><div style="color:#39a8ff;font-size:13px;font-weight:700;letter-spacing:1.5px">LANKA EV PLUS</div><h1 style="margin:16px 0 8px;font-size:26px;color:#fff">Verify your email</h1><p style="line-height:1.6;color:#b8c3d6">Hello ${safeName}, use this code to complete your account:</p><div style="margin:28px 0;padding:18px;text-align:center;background:#0b1220;border-radius:12px;color:#fff;font-size:34px;font-weight:700;letter-spacing:10px">${otp}</div><p style="line-height:1.6;color:#b8c3d6">This code expires in ${expiresInMinutes} minutes. Never share it; our support team will never ask for it.</p><p style="margin-top:28px;font-size:13px;color:#7f8da3">If you did not request this account, you can safely ignore this email.</p></td></tr></table></td></tr></table></body></html>`;

  return getTransporter().sendMail({
    from: { name: process.env.MAIL_FROM_NAME, address: process.env.MAIL_FROM },
    to,
    subject,
    text,
    html,
  });
}

export default { sendSignupOtp };
