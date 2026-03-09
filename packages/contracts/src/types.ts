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
  status: "ACTIVE" | "LOCKED" | "SUSPENDED";
  roleFlags: string[];
  needsSafetyAcknowledgement: boolean;
  faceAuthValid: boolean;
  runnerVerified: boolean;
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
  provider: "TOSS_FACE_AUTH";
  expiresAt: string;
}

export interface ReportRecord {
  reportId: string;
  jobId?: string;
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

export interface RouteDescriptor {
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
}

