import type {
  ChatMessage,
  CommunityPost,
  EmergencyEventRecord,
  FaceAuthSession,
  JobDetail,
  PaymentLedgerEntry,
  ReportRecord,
  ReviewRecord,
  RunnerEligibilitySnapshot
} from "../../../packages/contracts/src/index.ts";

export interface DemoUser {
  userId: string;
  nickname: string;
  adultVerified: boolean;
  status: "ACTIVE" | "LOCKED" | "SUSPENDED";
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

export interface InMemoryStore {
  users: Map<string, DemoUser>;
  jobs: Map<string, StoredJob>;
  chatRooms: Map<string, ChatRoom>;
  chatMessages: Map<string, ChatMessage[]>;
  faceAuthSessions: Map<string, FaceAuthSession>;
  payments: Map<string, PaymentLedgerEntry>;
  reports: Map<string, ReportRecord>;
  emergencies: Map<string, EmergencyEventRecord>;
  reviews: Map<string, ReviewRecord>;
  communityPosts: Map<string, CommunityPost>;
  locationLogs: LocationLog[];
  proofPhotos: ProofPhoto[];
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
