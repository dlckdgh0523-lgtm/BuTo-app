export const JOB_STATUSES = [
  "DRAFT",
  "PAYMENT_PENDING",
  "OPEN",
  "OFFERING",
  "MATCHED",
  "RUNNER_EN_ROUTE",
  "RUNNER_ARRIVED",
  "PICKED_UP",
  "DELIVERING",
  "DELIVERY_PROOF_SUBMITTED",
  "CLIENT_CONFIRM_PENDING",
  "CHAT_BLOCKED",
  "COMPLETED",
  "DISPUTED",
  "CANCELLED",
  "FAILED_SETTLEMENT"
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "INITIATED",
  "AUTHENTICATED",
  "APPROVED",
  "HELD",
  "RELEASE_READY",
  "PAID_OUT",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "PAYOUT_FAILED",
  "CHARGEBACK_RISK"
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYOUT_STATUSES = [
  "PENDING",
  "RELEASE_READY",
  "HOLD",
  "PAID",
  "FAILED"
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const CHAT_MODERATION_STATUSES = [
  "PENDING_MODERATION",
  "DELIVERED",
  "WARN",
  "BLOCKED",
  "SEVERE_BLOCK"
] as const;

export type ChatModerationStatus = (typeof CHAT_MODERATION_STATUSES)[number];

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const REPORT_TYPES = [
  "ILLEGAL_REQUEST",
  "ABUSE",
  "FRAUD",
  "FALSE_COMPLETION",
  "LOSS_OR_DAMAGE",
  "SEXUAL_HARASSMENT",
  "OTHER"
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const EMERGENCY_EVENT_TYPES = [
  "SOS",
  "THREAT",
  "HARASSMENT",
  "ILLEGAL_REQUEST"
] as const;

export type EmergencyEventType = (typeof EMERGENCY_EVENT_TYPES)[number];

export const USER_ROLES = ["CLIENT", "RUNNER", "SYSTEM", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const FACE_AUTH_INTENTS = ["JOB_CREATE", "PAYMENT_CONFIRM"] as const;
export type FaceAuthIntent = (typeof FACE_AUTH_INTENTS)[number];

export const TRANSPORT_REQUIREMENTS = ["walk", "vehicle", "truck_1t_plus"] as const;
export type TransportRequirement = (typeof TRANSPORT_REQUIREMENTS)[number];

