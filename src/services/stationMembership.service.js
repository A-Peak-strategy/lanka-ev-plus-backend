import prisma from "../config/db.js";
import Decimal from "decimal.js";

const ALLOWED_DURATION_DAYS = new Set([30, 90, 365]);
const REQUEST_INCLUDE = {
  user: { select: { id: true, name: true, email: true, phone: true } },
  station: { select: { id: true, name: true, address: true } },
  membership: true,
};

function validateDiscountRate(value) {
  const rate = new Decimal(value);
  if (!rate.isFinite() || rate.lt(0) || rate.gte(100)) {
    throw new Error("discountRate must be at least 0 and less than 100");
  }
  return rate.toFixed(2);
}

function validateDurationDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || !ALLOWED_DURATION_DAYS.has(days)) {
    throw new Error("durationDays must be one of: 30, 90, 365");
  }
  return days;
}

async function audit(adminId, action, targetType, targetId, previousValue, newValue) {
  return prisma.adminAuditLog.create({
    data: { adminId, action, targetType, targetId, previousValue, newValue },
  });
}

export async function createRequest(userId, { stationId, requestedDurationDays, paymentNotes }) {
  if (!stationId) throw new Error("stationId is required");
  const station = await prisma.station.findFirst({ where: { id: stationId, isActive: true } });
  if (!station) throw new Error("Active station not found");

  const [membership, pending] = await Promise.all([
    prisma.stationMembership.findFirst({
      where: { userId, stationId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    }),
    prisma.stationMembershipRequest.findFirst({
      where: { userId, stationId, status: { in: ["PENDING_REVIEW", "PAYMENT_PENDING", "PAYMENT_RECEIVED"] } },
    }),
  ]);
  if (membership) throw new Error("You already have an active membership for this station");
  if (pending) throw new Error("A membership request for this station is already under review");

  return prisma.stationMembershipRequest.create({
    data: { userId, stationId, requestedDurationDays: requestedDurationDays ? validateDurationDays(requestedDurationDays) : null, paymentNotes: paymentNotes || null },
    include: REQUEST_INCLUDE,
  });
}

export async function getUserRequests(userId) {
  return prisma.stationMembershipRequest.findMany({ where: { userId }, include: REQUEST_INCLUDE, orderBy: { createdAt: "desc" } });
}

export async function getUserMemberships(userId) {
  const now = new Date();
  return prisma.stationMembership.findMany({
    where: { userId },
    include: { station: { select: { id: true, name: true, address: true } }, request: true },
    orderBy: { expiresAt: "desc" },
  }).then(items => items.map(item => ({ ...item, isCurrentlyValid: item.status === "ACTIVE" && item.startsAt <= now && item.expiresAt > now })));
}

export async function listRequests({ status, stationId, userId, limit = 50, offset = 0 }) {
  const where = { ...(status ? { status } : {}), ...(stationId ? { stationId } : {}), ...(userId ? { userId } : {}) };
  const [data, total] = await Promise.all([
    prisma.stationMembershipRequest.findMany({ where, include: REQUEST_INCLUDE, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(Number(limit) || 50, 1), 100), skip: Math.max(Number(offset) || 0, 0) }),
    prisma.stationMembershipRequest.count({ where }),
  ]);
  return { data, total };
}

export async function getRequest(requestId) {
  const request = await prisma.stationMembershipRequest.findUnique({ where: { id: requestId }, include: REQUEST_INCLUDE });
  if (!request) throw new Error("Membership request not found");
  return request;
}

export async function recordPayment(requestId, { paymentAmount, paymentReference, paymentNotes }, adminId) {
  const request = await getRequest(requestId);
  if (["APPROVED", "REJECTED", "CANCELLED"].includes(request.status)) throw new Error("This request can no longer be updated");
  if (paymentAmount === undefined || new Decimal(paymentAmount).lte(0)) throw new Error("paymentAmount must be greater than 0");
  if (!paymentReference?.trim()) throw new Error("paymentReference is required");

  const updated = await prisma.stationMembershipRequest.update({
    where: { id: requestId },
    data: { status: "PAYMENT_RECEIVED", paymentAmount: new Decimal(paymentAmount).toFixed(2), paymentReference: paymentReference.trim(), paymentNotes: paymentNotes || request.paymentNotes, paymentReceivedAt: new Date(), paymentReceivedByAdminId: adminId },
    include: REQUEST_INCLUDE,
  });
  await audit(adminId, "RECORD_MEMBERSHIP_PAYMENT", "STATION_MEMBERSHIP_REQUEST", requestId, { status: request.status }, { status: updated.status, paymentAmount: updated.paymentAmount, paymentReference: updated.paymentReference });
  return updated;
}

export async function setPaymentInstructions(requestId, { paymentAmount, paymentNotes }, adminId) {
  const request = await getRequest(requestId);
  if (["APPROVED", "REJECTED", "CANCELLED"].includes(request.status)) throw new Error("This request can no longer be updated");
  if (paymentAmount === undefined || new Decimal(paymentAmount).lte(0)) throw new Error("paymentAmount must be greater than 0");
  const updated = await prisma.stationMembershipRequest.update({
    where: { id: requestId },
    data: { status: "PAYMENT_PENDING", paymentAmount: new Decimal(paymentAmount).toFixed(2), paymentNotes: paymentNotes || request.paymentNotes, reviewedAt: new Date(), reviewedByAdminId: adminId },
    include: REQUEST_INCLUDE,
  });
  await audit(adminId, "SET_MEMBERSHIP_PAYMENT_INSTRUCTIONS", "STATION_MEMBERSHIP_REQUEST", requestId, { status: request.status }, { status: updated.status, paymentAmount: updated.paymentAmount });
  return updated;
}

export async function approveRequest(requestId, { discountRate, durationDays, startsAt, adminNotes }, adminId) {
  const request = await getRequest(requestId);
  if (request.status !== "PAYMENT_RECEIVED") throw new Error("Bank payment must be recorded before approval");
  const normalizedRate = validateDiscountRate(discountRate);
  const days = validateDurationDays(durationDays || request.requestedDurationDays);
  const start = startsAt ? new Date(startsAt) : new Date();
  if (Number.isNaN(start.getTime())) throw new Error("startsAt must be a valid date");
  const expiry = new Date(start); expiry.setUTCDate(expiry.getUTCDate() + days);

  const result = await prisma.$transaction(async tx => {
    const existing = await tx.stationMembership.findUnique({ where: { userId_stationId: { userId: request.userId, stationId: request.stationId } } });
    if (existing?.status === "ACTIVE" && existing.expiresAt > new Date()) throw new Error("User already has an active membership for this station");
    const membership = existing
      ? await tx.stationMembership.update({ where: { id: existing.id }, data: { requestId, discountRate: normalizedRate, status: "ACTIVE", startsAt: start, expiresAt: expiry, approvedAt: new Date(), approvedByAdminId: adminId, revokedAt: null, revokedByAdminId: null, revocationReason: null, adminNotes: adminNotes || null } })
      : await tx.stationMembership.create({ data: { userId: request.userId, stationId: request.stationId, requestId, discountRate: normalizedRate, startsAt: start, expiresAt: expiry, approvedByAdminId: adminId, adminNotes: adminNotes || null } });
    const updatedRequest = await tx.stationMembershipRequest.update({ where: { id: requestId }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedByAdminId: adminId, adminNotes: adminNotes || request.adminNotes } });
    return { membership, request: updatedRequest };
  });
  await audit(adminId, "APPROVE_STATION_MEMBERSHIP", "STATION_MEMBERSHIP", result.membership.id, null, { requestId, discountRate: normalizedRate, startsAt: start, expiresAt: expiry });
  return result;
}

export async function rejectRequest(requestId, { rejectionReason, adminNotes }, adminId) {
  const request = await getRequest(requestId);
  if (["APPROVED", "REJECTED", "CANCELLED"].includes(request.status)) throw new Error("This request can no longer be rejected");
  if (!rejectionReason?.trim()) throw new Error("rejectionReason is required");
  const updated = await prisma.stationMembershipRequest.update({ where: { id: requestId }, data: { status: "REJECTED", rejectionReason: rejectionReason.trim(), adminNotes: adminNotes || request.adminNotes, reviewedAt: new Date(), reviewedByAdminId: adminId }, include: REQUEST_INCLUDE });
  await audit(adminId, "REJECT_STATION_MEMBERSHIP_REQUEST", "STATION_MEMBERSHIP_REQUEST", requestId, { status: request.status }, { status: updated.status, rejectionReason: updated.rejectionReason });
  return updated;
}

export async function listMemberships({ stationId, userId, status, limit = 50, offset = 0 }) {
  const where = { ...(stationId ? { stationId } : {}), ...(userId ? { userId } : {}), ...(status ? { status } : {}) };
  const [data, total] = await Promise.all([
    prisma.stationMembership.findMany({ where, include: { user: { select: { id: true, name: true, email: true, phone: true } }, station: { select: { id: true, name: true, address: true } }, request: true }, orderBy: { updatedAt: "desc" }, take: Math.min(Math.max(Number(limit) || 50, 1), 100), skip: Math.max(Number(offset) || 0, 0) }),
    prisma.stationMembership.count({ where }),
  ]);
  return { data, total };
}

export async function updateMembership(membershipId, { discountRate, expiresAt, adminNotes }, adminId) {
  const membership = await prisma.stationMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new Error("Membership not found");
  const data = {};
  if (discountRate !== undefined) data.discountRate = validateDiscountRate(discountRate);
  if (expiresAt !== undefined) { const date = new Date(expiresAt); if (Number.isNaN(date.getTime()) || date <= membership.startsAt) throw new Error("expiresAt must be after startsAt"); data.expiresAt = date; }
  if (adminNotes !== undefined) data.adminNotes = adminNotes || null;
  if (!Object.keys(data).length) throw new Error("No membership fields to update");
  const updated = await prisma.stationMembership.update({ where: { id: membershipId }, data });
  await audit(adminId, "UPDATE_STATION_MEMBERSHIP", "STATION_MEMBERSHIP", membershipId, { discountRate: membership.discountRate, expiresAt: membership.expiresAt }, { discountRate: updated.discountRate, expiresAt: updated.expiresAt });
  return updated;
}

export async function revokeMembership(membershipId, { reason }, adminId) {
  const membership = await prisma.stationMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new Error("Membership not found");
  if (membership.status !== "ACTIVE") throw new Error("Only active memberships can be revoked");
  const updated = await prisma.stationMembership.update({ where: { id: membershipId }, data: { status: "REVOKED", revokedAt: new Date(), revokedByAdminId: adminId, revocationReason: reason || null } });
  await audit(adminId, "REVOKE_STATION_MEMBERSHIP", "STATION_MEMBERSHIP", membershipId, { status: membership.status }, { status: updated.status, reason: updated.revocationReason });
  return updated;
}

export async function getActiveMembershipForCharging(userId, chargerId, at = new Date()) {
  // Keeps older lightweight Prisma mocks compatible; production Prisma always
  // exposes both delegates after this feature's migration/client generation.
  if (!prisma.charger || !prisma.stationMembership) return null;
  const charger = await prisma.charger.findUnique({ where: { id: chargerId }, select: { stationId: true } });
  if (!charger?.stationId) return null;
  return prisma.stationMembership.findFirst({ where: { userId, stationId: charger.stationId, status: "ACTIVE", startsAt: { lte: at }, expiresAt: { gt: at } } });
}

export default { createRequest, getUserRequests, getUserMemberships, listRequests, getRequest, setPaymentInstructions, recordPayment, approveRequest, rejectRequest, listMemberships, updateMembership, revokeMembership, getActiveMembershipForCharging };
