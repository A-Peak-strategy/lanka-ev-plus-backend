import { Router } from "express";
import { verifyFirebaseToken } from "../middleware/auth.middleware.js";
import { sendEmailOtp, verifyEmailOtp } from "./auth.controller.js";

const router = Router();
router.use(verifyFirebaseToken);
router.post("/email-verification/send", sendEmailOtp);
router.post("/email-verification/resend", sendEmailOtp);
router.post("/email-verification/verify", verifyEmailOtp);
export default router;
