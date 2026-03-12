import type {
  ChatModerationStatus,
  EmergencyEventType,
  FaceAuthIntent,
  JobStatus,
  PaymentStatus,
  PayoutStatus,
  ReportType,
  RiskLevel,
  TransportRequirement
} from "./enums.ts";

export type AccountStatus =
  | "ACTIVE"
  | "RESTRICTED"
  | "SUSPENDED"
  | "APPEAL_PENDING"
  | "REINSTATED"
  | "PERMANENTLY_BANNED"
  | "WITHDRAWN";
export type AccountRestrictionSource = "AI_MODERATION" | "ADMIN_POLICY" | "SELF_WITHDRAWAL";
export type EnforcementScope = "ACCOUNT_FULL" | "CHAT_ONLY" | "MATCHING_DISABLED" | "PAYOUT_HOLD";
export type EnforcementReviewStatus =
  | "AUTO_APPLIED"
  | "UNDER_REVIEW"
  | "APPEAL_PENDING"
  | "MORE_INFO_REQUESTED"
  | "UPHELD"
  | "REINSTATED";
export type AppealStatus = "SUBMITTED" | "MORE_INFO_REQUESTED" | "APPROVED" | "REJECTED";
export type AppealDecision = "APPROVE" | "REJECT" | "REQUEST_MORE_INFO";

export interface AccountRestrictionInfo {
  status: Exclude<AccountStatus, "ACTIVE" | "WITHDRAWN">;
  reasonCode: string;
  reasonMessage: string;
  source: AccountRestrictionSource;
  scope: EnforcementScope;
  reviewStatus: EnforcementReviewStatus;
  updatedAt: string;
  actionId?: string;
  supportAction?: "KAKAO_CHANNEL";
}

export interface UserEnforcementAction {
  actionId: string;
  userId: string;
  statusApplied: Exclude<AccountStatus, "ACTIVE" | "WITHDRAWN">;
  source: Exclude<AccountRestrictionSource, "SELF_WITHDRAWAL">;
  scope: EnforcementScope;
  reviewStatus: EnforcementReviewStatus;
  reasonCode: string;
  reasonMessage: string;
  appealEligible: boolean;
  evidenceBundleId: string;
  createdAt: string;
  liftedAt?: string;
  liftedByActionId?: string;
}

export interface EnforcementEvidenceBundle {
  evidenceBundleId: string;
  userId: string;
  sourceActionId: string;
  evidenceType: "CHAT_MESSAGE" | "ADMIN_NOTE" | "PAYMENT_RISK" | "LOCATION_PROOF" | "SYSTEM_EVENT";
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface UserAppeal {
  appealId: string;
  userId: string;
  actionId: string;
  appealText: string;
  status: AppealStatus;
  submittedAt: string;
  lastUpdatedAt: string;
}

export interface AppealReviewAction {
  reviewActionId: string;
  appealId: string;
  actionId: string;
  reviewerUserId: string;
  decision: AppealDecision;
  note?: string;
  createdAt: string;
}

export interface EnforcementStatusSummary {
  userId: string;
  status: AccountStatus;
  restriction?: AccountRestrictionInfo;
  latestAction?: UserEnforcementAction;
  latestAppeal?: UserAppeal;
  supportAction?: "KAKAO_CHANNEL";
}

export interface AddressPoint {
  address: string;
  detailAddress?: string;
  lat: number;
  lng: number;
}

export interface CreateJobRequest {
  title: string;
  description: string;
  pickup: AddressPoint;
  dropoff: AddressPoint;
  transportRequirement: TransportRequirement;
  vehicleTierRequired?: string;
  offerAmount: number;
  requestedStartAt?: string;
  attachments?: string[];
  urgent?: boolean;
}

export interface JobCard {
  jobId: string;
  title: string;
  distanceKm: number;
  offerAmount: number;
  transportRequirement: TransportRequirement;
  status: JobStatus;
  riskLevel: RiskLevel;
}

export interface JobDetail extends CreateJobRequest {
  jobId: string;
  clientUserId: string;
  status: JobStatus;
  riskLevel: RiskLevel;
  requiresManualReview: boolean;
  paymentInitRequired: boolean;
}

export interface ChatMessage {
  messageId: string;
  roomId: string;
  senderUserId: string;
  messageType: "text" | "image" | "system";
  body: string;
  moderationStatus: ChatModerationStatus;
  actionTaken: string;
  createdAt: string;
}

export interface ModerationDecision {
  status: ChatModerationStatus;
  actionTaken: string;
  reasons: string[];
}

export interface PaymentLedgerEntry {
  paymentId: string;
  jobId: string;
  userId: string;
  orderId: string;
  status: PaymentStatus;
  amountTotal: number;
  heldAmount: number;
  feeAmount: number;
  payToken?: string;
  transactionId?: string;
  providerPaymentMethod?: string;
  providerStatus?: string;
  refundableAmount?: number;
  approvedAt?: string;
}

export interface PayoutReleaseDecision {
  status: PayoutStatus;
  releasable: boolean;
  reason: string;
  releaseAt?: string;
}

export interface RunnerEligibilitySnapshot {
  runnerUserId: string;
  transportMode: "walk" | "vehicle";
  vehicleTier?: string;
  businessVerified: boolean;
  payoutAccountVerified: boolean;
  riskScore: number;
  activeJobs: number;
  lastActiveAt: string;
}

export interface FaceAuthValidity {
  userId: string;
  intent: FaceAuthIntent;
  verified: boolean;
  verifiedAt?: string;
  validUntil?: string;
}

export interface SafetyAcknowledgementState {
  rulesVersion: string;
  acknowledgedAt?: string;
  needsAcknowledgement: boolean;
}

export interface AuthenticatedUserSummary {
  userId: string;
  nickname: string;
  adultVerified: boolean;
  status: AccountStatus;
  roleFlags: string[];
  needsSafetyAcknowledgement: boolean;
  faceAuthValid: boolean;
  runnerVerified: boolean;
  restriction?: AccountRestrictionInfo;
}

export interface SafetyRuleDocument {
  rulesVersion: string;
  title: string;
  items: string[];
  requiresAcknowledgement: boolean;
}

export interface FaceAuthSession {
  faceAuthSessionId: string;
  userId: string;
  jobDraftId?: string;
  intent: FaceAuthIntent;
  provider: "TOSS_ONE_TOUCH_AUTH";
  providerRequestId?: string;
  requestUrl?: string;
  txId?: string;
  tossFaceTxId?: string;
  verifiedAt?: string;
  consumedAt?: string;
  expiresAt: string;
}

export interface ReportRecord {
  reportId: string;
  jobId?: string;
  reporterUserId: string;
  targetUserId: string;
  reportType: ReportType;
  detail?: string;
  createdAt: string;
}

export interface EmergencyEventRecord {
  emergencyEventId: string;
  jobId: string;
  eventType: EmergencyEventType;
  lat: number;
  lng: number;
  createdAt: string;
}

export interface ReviewRecord {
  reviewId: string;
  jobId: string;
  authorUserId: string;
  targetUserId: string;
  ratingValue: number;
  body: string;
  createdAt: string;
}

export interface CommunityPost {
  postId: string;
  authorUserId: string;
  title: string;
  body: string;
  imageUrl?: string;
  createdAt: string;
}

export interface NotificationRecord {
  notificationId: string;
  userId: string;
  channel: "IN_APP";
  category: "SAFETY" | "TRANSACTION" | "ACCOUNT" | "CHAT";
  title: string;
  body: string;
  deepLink?: string;
  relatedEntityType?: "JOB" | "APPEAL" | "USER" | "CHAT_ROOM";
  relatedEntityId?: string;
  triggeredByEventId: string;
  createdAt: string;
  readAt?: string;
}

export interface PushSubscriptionRecord {
  subscriptionId: string;
  userId: string;
  provider: "WEBHOOK" | "FCM" | "APNS";
  endpoint: string;
  authSecret?: string;
  p256dh?: string;
  deviceLabel?: string;
  createdAt: string;
  lastSeenAt: string;
  disabledAt?: string;
  failureCount: number;
}

export interface PushDeliveryAttemptRecord {
  deliveryAttemptId: string;
  notificationId: string;
  subscriptionId: string;
  provider: "WEBHOOK" | "FCM" | "APNS";
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  attemptedAt: string;
  providerMessageId?: string;
  errorMessage?: string;
}

export interface SupportFallbackRecord {
  fallbackId: string;
  userId: string;
  sourceNotificationId: string;
  channel: "KAKAO_CHANNEL";
  status: "OPEN" | "ACKNOWLEDGED";
  reasonCode: "NO_ACTIVE_PUSH_SUBSCRIPTION" | "PUSH_DELIVERY_DISABLED" | "PUSH_DELIVERY_REPEATED_FAILURE";
  reasonMessage: string;
  createdAt: string;
  acknowledgedAt?: string;
}

export interface AdminOpsDashboard {
  queueCounts: {
    reviewQueue: number;
    disputes: number;
    emergencies: number;
    blockedUsers: number;
    withdrawnUsers: number;
  };
  push: {
    subscriptions: {
      total: number;
      active: number;
      disabled: number;
      failing: number;
    };
    deliveries: {
      total: number;
      success: number;
      failed: number;
      skipped: number;
    };
  };
  supportFallbacks: {
    total: number;
    open: number;
    acknowledged: number;
  };
  workers: Array<{
    workerKey: string;
    lastStartedAt: string;
    lastCompletedAt?: string;
    lastStatus: "RUNNING" | "SUCCESS" | "FAILED";
    lastSummary?: Record<string, unknown>;
  }>;
  recentAlerts: Array<{
    kind: "EMERGENCY" | "SUPPORT_FALLBACK" | "PUSH_FAILURE" | "WORKER_FAILURE";
    entityId: string;
    title: string;
    createdAt: string;
  }>;
}

export interface WorkerHeartbeatRecord {
  workerKey: string;
  lastStartedAt: string;
  lastCompletedAt?: string;
  lastStatus: "RUNNING" | "SUCCESS" | "FAILED";
  lastSummary?: Record<string, unknown>;
}

export interface RuntimeReadinessCheck {
  key: string;
  status: "PASS" | "WARN" | "BLOCK";
  title: string;
  detail: string;
  owner: "BACKEND" | "INFRA" | "SECURITY" | "RISK_OPS" | "PARTNERSHIP";
  remediation: string;
  envKeys?: string[];
  references?: string[];
}

export interface RuntimeReadinessOwnerSummary {
  owner: RuntimeReadinessCheck["owner"];
  blockers: number;
  warnings: number;
  passing: number;
  total: number;
}

export interface RuntimeReadinessSummary {
  overallStatus: "READY" | "WARN" | "ACTION_REQUIRED";
  checkedAt: string;
  blockers: number;
  warnings: number;
  checks: RuntimeReadinessCheck[];
  owners: RuntimeReadinessOwnerSummary[];
}

export interface RouteDescriptor {
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
}
