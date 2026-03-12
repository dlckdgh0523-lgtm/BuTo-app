import type {
  AccountRestrictionInfo,
  AccountStatus,
  AppealReviewAction,
  ChatMessage,
  CommunityPost,
  EmergencyEventRecord,
  EnforcementEvidenceBundle,
  FaceAuthSession,
  JobDetail,
  NotificationRecord,
  PaymentLedgerEntry,
  PushDeliveryAttemptRecord,
  PushSubscriptionRecord,
  ReportRecord,
  ReviewRecord,
  SupportFallbackRecord,
  RunnerEligibilitySnapshot,
  UserAppeal,
  UserEnforcementAction,
  WorkerHeartbeatRecord
} from "../../../packages/contracts/src/index.ts";

export interface DemoUser {
  userId: string;
  ciHash: string;
  tossUserKey?: string;
  nickname: string;
  adultVerified: boolean;
  status: AccountStatus;
  roleFlags: string[];
  safetyAcknowledgedAt?: string;
  runnerVerified: boolean;
  riskScore: number;
  transportMode?: "walk" | "vehicle";
  vehicleTier?: string;
  businessVerified: boolean;
  payoutAccountVerified: boolean;
  activeJobs: number;
  lastActiveAt: string;
  restriction?: AccountRestrictionInfo;
  withdrawnAt?: string;
}

export interface StoredJob extends JobDetail {
  matchedRunnerUserId?: string;
  chatRoomId?: string;
  hasReport: boolean;
  hasDispute: boolean;
  clientConfirmed: boolean;
  autoConfirmExpired: boolean;
}

export interface ChatRoom {
  roomId: string;
  jobId: string;
  status: "OPEN" | "LOCKED" | "CLOSED";
  createdAt: string;
}

export interface LocationLog {
  jobId: string;
  userId: string;
  role: "CLIENT" | "RUNNER";
  lat: number;
  lng: number;
  accuracy: number;
  source: "app" | "background" | "manual";
  loggedAt: string;
}

export interface ProofPhoto {
  proofId: string;
  jobId: string;
  uploadedBy: string;
  proofType: "pickup" | "delivery";
  s3Key: string;
  watermarkedUrl: string;
  createdAt: string;
}

export interface ProofUploadSession {
  uploadSessionId: string;
  jobId: string;
  userId: string;
  proofType: "pickup" | "delivery";
  source: "camera" | "album";
  objectKey: string;
  status: "READY" | "UPLOADED" | "COMPLETED" | "EXPIRED";
  localAssetPath?: string;
  mimeType?: string;
  imageId?: string;
  createdAt: string;
  expiresAt: string;
  uploadedAt?: string;
  completedAt?: string;
}

export interface JobCancellationRequest {
  cancellationRequestId: string;
  jobId: string;
  requestedByUserId: string;
  requesterRole: "CLIENT" | "SYSTEM";
  reason: string;
  status: "PENDING_RUNNER_CONFIRMATION" | "ACCEPTED" | "REJECTED" | "AUTO_CANCELLED";
  requestedAt: string;
  respondedAt?: string;
  responseByUserId?: string;
  responseNote?: string;
  refundReasonNormalized?: string;
}

export interface RefreshSession {
  userId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface PendingLoginState {
  state: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuditLogEntry {
  auditId: string;
  actorUserId: string;
  action: string;
  entityType: "JOB" | "USER";
  entityId: string;
  note?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  createdAt: string;
}

export interface InMemoryStore {
  users: Map<string, DemoUser>;
  loginStates: Map<string, PendingLoginState>;
  refreshSessions: Map<string, RefreshSession>;
  jobs: Map<string, StoredJob>;
  chatRooms: Map<string, ChatRoom>;
  chatMessages: Map<string, ChatMessage[]>;
  faceAuthSessions: Map<string, FaceAuthSession>;
  payments: Map<string, PaymentLedgerEntry>;
  reports: Map<string, ReportRecord>;
  emergencies: Map<string, EmergencyEventRecord>;
  proofUploadSessions: Map<string, ProofUploadSession>;
  jobCancellationRequests: Map<string, JobCancellationRequest>;
  reviews: Map<string, ReviewRecord>;
  communityPosts: Map<string, CommunityPost>;
  notifications: Map<string, NotificationRecord>;
  pushSubscriptions: Map<string, PushSubscriptionRecord>;
  pushDeliveryAttempts: Map<string, PushDeliveryAttemptRecord>;
  supportFallbacks: Map<string, SupportFallbackRecord>;
  userEnforcementActions: Map<string, UserEnforcementAction>;
  enforcementEvidenceBundles: Map<string, EnforcementEvidenceBundle>;
  userAppeals: Map<string, UserAppeal>;
  appealReviewActions: Map<string, AppealReviewAction>;
  workerHeartbeats: Map<string, WorkerHeartbeatRecord>;
  locationLogs: LocationLog[];
  proofPhotos: ProofPhoto[];
  auditLogs: AuditLogEntry[];
  idempotency: Map<string, unknown>;
}

export function makeRunnerSnapshot(user: DemoUser): RunnerEligibilitySnapshot {
  return {
    runnerUserId: user.userId,
    transportMode: user.transportMode ?? "walk",
    vehicleTier: user.vehicleTier,
    businessVerified: user.businessVerified,
    payoutAccountVerified: user.payoutAccountVerified,
    riskScore: user.riskScore,
    activeJobs: user.activeJobs,
    lastActiveAt: user.lastActiveAt
  };
}
