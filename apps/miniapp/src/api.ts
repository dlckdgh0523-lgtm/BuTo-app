import type {
  AppealReviewAction,
  AdminOpsDashboard,
  AuthenticatedUserSummary,
  EnforcementStatusSummary,
  JobCard,
  NotificationRecord,
  RuntimeReadinessSummary,
  SafetyRuleDocument,
  SupportFallbackRecord,
  UserAppeal,
  UserEnforcementAction
} from "../../../packages/contracts/src/index.ts";

const API_BASE_URL = import.meta.env.VITE_BUTO_API_BASE_URL ?? "http://localhost:4000";

interface ApiSuccess<T> {
  resultType: "SUCCESS";
  success: T;
}

interface ApiFailure {
  resultType: "ERROR";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export interface LoginSession {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUserSummary;
  needsSafetyAcknowledgement: boolean;
  needsFaceAuth: boolean;
}

export interface StartedLogin {
  state: string;
  expiresAt: string;
}

export interface StartedFaceAuth {
  faceAuthSessionId: string;
  txId?: string;
  requestUrl?: string;
  expiresAt: string;
}

export interface CompletedFaceAuth {
  verified: boolean;
  verifiedAt?: string;
  validUntil?: string;
  riskCode: string;
}

export interface EnforcementActionWithEvidence extends UserEnforcementAction {
  evidenceBundle?: {
    evidenceBundleId: string;
    evidenceType: string;
    summary: string;
    createdAt: string;
  };
}

export interface AppealDetail extends UserAppeal {
  action?: UserEnforcementAction;
  reviewActions: AppealReviewAction[];
}

export interface AdminDisputeItem {
  jobId: string;
  clientUserId: string;
  matchedRunnerUserId?: string;
  title: string;
  description: string;
  status: string;
  riskLevel: string;
  hasReport: boolean;
  hasDispute: boolean;
}

export interface AdminDisputeListResponse {
  items: AdminDisputeItem[];
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
}

export interface WorkerHeartbeatItem {
  workerKey: string;
  lastStartedAt: string;
  lastCompletedAt?: string;
  lastStatus: "RUNNING" | "SUCCESS" | "FAILED";
  lastSummary?: Record<string, unknown>;
}

export interface MarkdownDocumentResponse {
  fileName: string;
  markdown: string;
}

export interface SubmissionBundleSummary {
  bundleLabel: string;
  generatedAt: string;
  overallStatus: "READY" | "WARN" | "ACTION_REQUIRED";
  blockers: number;
  warnings: number;
  documentCount: number;
  envFileCount: number;
  integrityStatus: "COMPLETE" | "INCOMPLETE";
  missingFiles: string[];
  driftStatus: "IN_SYNC" | "STALE";
  driftReasons: string[];
}

export interface SubmissionBundleDetail extends SubmissionBundleSummary {
  readmeMarkdown: string;
  documents: Array<{
    fileName: string;
    title: string;
    sourcePath: string;
  }>;
  envFiles: Array<{
    fileName: string;
    owner: string;
  }>;
}

export interface SubmissionBundleRecommendation {
  recommendedBundleLabel: string | null;
  status: "READY_TO_SUBMIT" | "ACTION_REQUIRED";
  reasons: string[];
}

export interface ReleaseSubmissionDecision {
  decision: "BLOCKED" | "CONDITIONAL" | "READY";
  recommendedBundleLabel: string | null;
  summary: string;
  reasons: string[];
}

export interface AdminDisputeDetail {
  job: AdminDisputeItem & {
    offerAmount: number;
    pickupAddress: string;
    dropoffAddress: string;
    chatRoomId?: string;
    clientConfirmed: boolean;
    autoConfirmExpired: boolean;
  };
  payment?: {
    paymentId: string;
    status: string;
    amountTotal: number;
    heldAmount: number;
    feeAmount: number;
    providerPaymentMethod?: string;
    providerStatus?: string;
    transactionId?: string;
    approvedAt?: string;
  };
  proofPhotos: Array<{
    proofId: string;
    uploadedBy: string;
    proofType: "pickup" | "delivery";
    s3Key: string;
    watermarkedUrl: string;
    createdAt: string;
  }>;
  locationLogs: Array<{
    userId: string;
    role: "CLIENT" | "RUNNER";
    lat: number;
    lng: number;
    accuracy: number;
    source: "app" | "background" | "manual";
    loggedAt: string;
  }>;
  chatMessages: Array<{
    messageId: string;
    senderUserId: string;
    senderNickname: string;
    messageType: "text" | "image" | "system";
    body: string;
    moderationStatus: string;
    actionTaken: string;
    createdAt: string;
  }>;
  reports: Array<{
    reportId: string;
    reporterUserId: string;
    targetUserId: string;
    reportType: string;
    detail?: string;
    createdAt: string;
  }>;
  emergencies: Array<{
    emergencyEventId: string;
    eventType: string;
    lat: number;
    lng: number;
    createdAt: string;
  }>;
  latestCancellationRequest?: {
    cancellationRequestId: string;
    requestedByUserId: string;
    requesterRole: "CLIENT" | "SYSTEM";
    reason: string;
    status: "PENDING_RUNNER_CONFIRMATION" | "ACCEPTED" | "REJECTED" | "AUTO_CANCELLED";
    requestedAt: string;
    respondedAt?: string;
    responseNote?: string;
    refundReasonNormalized?: string;
  };
}

export interface ActiveJobItem {
  jobId: string;
  title: string;
  status: string;
  transportRequirement: string;
  riskLevel: string;
  offerAmount: number;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  lastLocationLoggedAt?: string;
  lastChatMessageAt?: string;
  chatIdleAutoCancelAt?: string;
  counterpartUserId?: string;
  hasDispute: boolean;
  isRunnerView: boolean;
  isClientView: boolean;
  proofCounts: {
    pickup: number;
    delivery: number;
  };
  cancellationRequest?: {
    cancellationRequestId: string;
    requestedByUserId: string;
    requesterRole: "CLIENT" | "SYSTEM";
    reason: string;
    status: "PENDING_RUNNER_CONFIRMATION" | "ACCEPTED" | "REJECTED" | "AUTO_CANCELLED";
    requestedAt: string;
    respondedAt?: string;
    responseNote?: string;
  };
}

export interface ProofUploadSessionEnvelope {
  uploadSessionId: string;
  expiresAt: string;
  maxBytes: number;
  acceptedMimeTypes: string[];
  uploadMode: "SIGNED_UPLOAD_POST" | "S3_PRESIGNED_PUT";
  uploadMethod: "POST" | "PUT";
  uploadUrl: string;
  publicAssetBaseUrl: string;
  uploadHeaders?: Record<string, string>;
}

export interface CreatedJob {
  jobId: string;
  status: string;
  riskLevel: string;
  requiresManualReview: boolean;
  paymentInitRequired: boolean;
  policyDisposition: string;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

async function request<T>(path: string, options?: {
  method?: "GET" | "POST";
  accessToken?: string;
  body?: Record<string, unknown>;
}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options?.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {})
    },
    body: options?.body ? JSON.stringify(options.body) : undefined
  });

  const payload = (await response.json()) as ApiEnvelope<T>;
  if (payload.resultType === "ERROR") {
    throw new ApiClientError(payload.error.message, payload.error.code, payload.error.details);
  }

  return payload.success;
}

export async function startTossLogin() {
  return request<StartedLogin>("/auth/toss/login/start", {
    method: "POST",
    body: {}
  });
}

export async function completeTossLogin(input: { authorizationCode: string; state: string }) {
  return request<LoginSession>("/auth/toss/login/callback", {
    method: "POST",
    body: input
  });
}

export async function fetchSafetyRules() {
  return request<SafetyRuleDocument>("/safety/rules/current");
}

export async function acknowledgeSafety(input: { accessToken: string; rulesVersion: string }) {
  return request<{ acknowledgedAt: string; rulesVersion: string }>("/safety/acknowledgements", {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      rulesVersion: input.rulesVersion,
      acknowledged: true
    }
  });
}

export async function startSensitiveFaceAuth(input: { accessToken: string; intent: "JOB_CREATE" | "PAYMENT_CONFIRM" }) {
  return request<StartedFaceAuth>("/auth/toss-face/session", {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      intent: input.intent
    }
  });
}

export async function completeSensitiveFaceAuth(input: { accessToken: string; faceAuthSessionId: string }) {
  return request<CompletedFaceAuth>("/auth/toss-face/complete", {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      faceAuthSessionId: input.faceAuthSessionId
    }
  });
}

export async function fetchNearbyJobs(accessToken: string) {
  return request<{ items: JobCard[] }>("/jobs/nearby", {
    accessToken
  });
}

export async function createJobRequest(input: {
  accessToken: string;
  faceAuthSessionId: string;
  title: string;
  description: string;
  pickup: { address: string; lat: number; lng: number };
  dropoff: { address: string; lat: number; lng: number };
  transportRequirement: "walk" | "vehicle" | "truck_1t_plus";
  offerAmount: number;
}) {
  return request<CreatedJob>("/jobs", {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      title: input.title,
      description: input.description,
      pickup: input.pickup,
      dropoff: input.dropoff,
      transportRequirement: input.transportRequirement,
      offerAmount: input.offerAmount,
      faceAuthSessionId: input.faceAuthSessionId
    }
  });
}

export async function initJobPayment(input: { accessToken: string; jobId: string }) {
  return request<{ paymentOrderId: string; payToken?: string; amount: number; heldAmount: number; feeAmount: number }>(
    `/payments/jobs/${input.jobId}/init`,
    {
      method: "POST",
      accessToken: input.accessToken,
      body: {}
    }
  );
}

export async function confirmJobPayment(input: {
  accessToken: string;
  jobId: string;
  paymentOrderId: string;
  faceAuthSessionId: string;
}) {
  return request<{ paymentStatus: string; heldAmount: number; feeAmount: number; jobStatus: string; providerStatus?: string; transactionId?: string }>(
    `/payments/jobs/${input.jobId}/confirm`,
    {
      method: "POST",
      accessToken: input.accessToken,
      body: {
        paymentOrderId: input.paymentOrderId,
        faceAuthSessionId: input.faceAuthSessionId
      }
    }
  );
}

export async function reconcileJobPayment(input: {
  accessToken: string;
  jobId: string;
  paymentOrderId?: string;
}) {
  return request<{ paymentStatus: string; heldAmount: number; feeAmount: number; jobStatus: string; providerStatus?: string; transactionId?: string }>(
    `/payments/jobs/${input.jobId}/reconcile`,
    {
      method: "POST",
      accessToken: input.accessToken,
      body: {
        paymentOrderId: input.paymentOrderId
      }
    }
  );
}

export async function fetchActiveJobs(accessToken: string) {
  return request<{ items: ActiveJobItem[] }>("/me/jobs/active", {
    accessToken
  });
}

export async function updateJobStatus(input: { accessToken: string; jobId: string; nextStatus: string }) {
  return request<{ jobId: string; status: string; allowedNextStatuses: string[] }>(`/jobs/${input.jobId}/status`, {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      nextStatus: input.nextStatus
    }
  });
}

export async function createJobReport(input: {
  accessToken: string;
  jobId: string;
  targetUserId: string;
  reportType: "LOSS_OR_DAMAGE" | "FALSE_COMPLETION" | "ABUSE" | "FRAUD" | "OTHER";
  detail: string;
}) {
  return request<{ reportId: string; jobId?: string; reporterUserId: string; targetUserId: string; reportType: string; detail?: string; createdAt: string }>(
    "/reports",
    {
      method: "POST",
      accessToken: input.accessToken,
      body: {
        jobId: input.jobId,
        targetUserId: input.targetUserId,
        reportType: input.reportType,
        detail: input.detail
      }
    }
  );
}

export async function requestJobCancellation(input: { accessToken: string; jobId: string; reason: string }) {
  return request<{ jobId: string; status: string; requestedAt: string }>(`/jobs/${input.jobId}/cancellations/request`, {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      reason: input.reason
    }
  });
}

export async function respondJobCancellation(input: {
  accessToken: string;
  jobId: string;
  decision: "ACCEPT" | "REJECT";
  note?: string;
}) {
  return request<{ jobId: string; status: string; jobStatus?: string; refundReasonNormalized?: string; respondedAt?: string }>(
    `/jobs/${input.jobId}/cancellations/respond`,
    {
      method: "POST",
      accessToken: input.accessToken,
      body: {
        decision: input.decision,
        note: input.note
      }
    }
  );
}

export async function logJobLocation(input: {
  accessToken: string;
  jobId: string;
  lat: number;
  lng: number;
  accuracy: number;
  source: "app" | "background" | "manual";
}) {
  return request<{ saved: boolean; count: number; loggedAt: string }>(`/jobs/${input.jobId}/location-log`, {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy,
      source: input.source
    }
  });
}

export async function createProofUploadSession(input: {
  accessToken: string;
  jobId: string;
  proofType: "pickup" | "delivery";
  source: "camera" | "album";
  mimeType: string;
}) {
  return request<ProofUploadSessionEnvelope>(`/jobs/${input.jobId}/proof-photo/session`, {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      proofType: input.proofType,
      source: input.source,
      mimeType: input.mimeType
    }
  });
}

export async function uploadProofPhotoToSignedUrl(input: {
  uploadMode: "SIGNED_UPLOAD_POST" | "S3_PRESIGNED_PUT";
  uploadMethod: "POST" | "PUT";
  uploadUrl: string;
  uploadHeaders?: Record<string, string>;
  dataUri: string;
  imageId?: string;
  mimeTypeHint?: string;
}) {
  if (input.uploadMode === "S3_PRESIGNED_PUT") {
    const response = await fetch(input.uploadUrl, {
      method: input.uploadMethod,
      headers: {
        ...(input.uploadHeaders ?? {})
      },
      body: dataUriToBlob(input.dataUri)
    });

    if (!response.ok) {
      throw new ApiClientError("증빙 이미지를 외부 스토리지에 업로드하지 못했어요.", "PROOF_UPLOAD_EXTERNAL_FAILED", {
        status: response.status
      });
    }

    return {
      uploadedExternally: true as const
    };
  }

  const response = await fetch(input.uploadUrl, {
    method: input.uploadMethod,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      dataUri: input.dataUri,
      imageId: input.imageId,
      mimeTypeHint: input.mimeTypeHint
    })
  });
  const payload = (await response.json()) as ApiEnvelope<{ uploadSessionId: string; objectKey: string; uploadedAt: string }>;
  if (payload.resultType === "ERROR") {
    throw new ApiClientError(payload.error.message, payload.error.code, payload.error.details);
  }

  return payload.success;
}

export async function completeProofPhoto(input: {
  accessToken: string;
  jobId: string;
  proofType: "pickup" | "delivery";
  uploadSessionId: string;
}) {
  return request<{ proofId: string; watermarkedUrl: string; proofCount: number; jobStatus: string; completedAt: string }>(
    `/jobs/${input.jobId}/proof-photo/complete`,
    {
      method: "POST",
      accessToken: input.accessToken,
      body: {
        proofType: input.proofType,
        uploadSessionId: input.uploadSessionId
      }
    }
  );
}

function dataUriToBlob(dataUri: string) {
  const matched = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!matched) {
    throw new ApiClientError("지원하지 않는 이미지 데이터 형식이에요.", "PROOF_UPLOAD_INVALID");
  }

  const mimeType = matched[1];
  const binary = atob(matched[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

export async function logoutSession(input: { accessToken: string; refreshToken: string }) {
  return request<{ loggedOut: boolean }>("/auth/logout", {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      refreshToken: input.refreshToken
    }
  });
}

export async function withdrawMembership(input: { accessToken: string; reason?: string }) {
  return request<{ userId: string; status: "WITHDRAWN"; withdrawnAt: string }>("/me/withdraw", {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      confirmed: true,
      reason: input.reason
    }
  });
}

export async function fetchEnforcementStatus(accessToken: string) {
  return request<EnforcementStatusSummary>("/me/enforcement-status", {
    accessToken
  });
}

export async function fetchEnforcementActions(accessToken: string) {
  return request<{ items: EnforcementActionWithEvidence[] }>("/me/enforcement-actions", {
    accessToken
  });
}

export async function createAppeal(input: { accessToken: string; actionId?: string; appealText: string }) {
  return request<UserAppeal>("/appeals", {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      actionId: input.actionId,
      appealText: input.appealText
    }
  });
}

export async function fetchAppealDetail(input: { accessToken: string; appealId: string }) {
  return request<AppealDetail>(`/appeals/${input.appealId}`, {
    accessToken: input.accessToken
  });
}

export async function fetchAdminOpsDashboard(accessToken: string) {
  return request<AdminOpsDashboard>("/admin/ops-dashboard", {
    accessToken
  });
}

export async function fetchAdminDisputes(input: {
  accessToken: string;
  status?: string;
  riskLevel?: string;
  query?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}) {
  const query = new URLSearchParams();
  if (input.status && input.status !== "ALL") {
    query.set("status", input.status);
  }
  if (input.riskLevel && input.riskLevel !== "ALL") {
    query.set("riskLevel", input.riskLevel);
  }
  if (input.query?.trim()) {
    query.set("q", input.query.trim());
  }
  if (input.sort && input.sort !== "job_id_desc") {
    query.set("sort", input.sort);
  }
  query.set("page", String(input.page ?? 1));
  query.set("pageSize", String(input.pageSize ?? 10));

  return request<AdminDisputeListResponse>(`/admin/disputes?${query.toString()}`, {
    accessToken: input.accessToken
  });
}

export async function fetchAdminDisputeDetail(input: { accessToken: string; jobId: string }) {
  return request<AdminDisputeDetail>(`/admin/disputes/${input.jobId}`, {
    accessToken: input.accessToken
  });
}

export async function resolveAdminDispute(input: {
  accessToken: string;
  jobId: string;
  resolution: "COMPLETED" | "CANCELLED" | "FAILED_SETTLEMENT";
  note?: string;
}) {
  return request<{ jobId: string; status: string }>(`/admin/disputes/${input.jobId}/resolve`, {
    method: "POST",
    accessToken: input.accessToken,
    body: {
      resolution: input.resolution,
      note: input.note
    }
  });
}

export async function fetchRuntimeWorkers(accessToken: string) {
  return request<{ items: WorkerHeartbeatItem[] }>("/admin/runtime-workers", {
    accessToken
  });
}

export async function fetchRuntimeReadiness(accessToken: string) {
  return request<RuntimeReadinessSummary>("/admin/runtime-readiness", {
    accessToken
  });
}

export async function fetchRuntimeReadinessReport(accessToken: string) {
  return request<MarkdownDocumentResponse>("/admin/runtime-readiness/report", {
    accessToken
  });
}

export async function fetchRuntimeReadinessActionPlan(accessToken: string) {
  return request<MarkdownDocumentResponse>("/admin/runtime-readiness/action-plan", {
    accessToken
  });
}

export async function fetchRuntimeReadinessEnvHandoff(accessToken: string) {
  return request<MarkdownDocumentResponse>("/admin/runtime-readiness/env-handoff", {
    accessToken
  });
}

export async function fetchRuntimeReadinessEnvHandoffByOwner(input: {
  accessToken: string;
  owner: RuntimeReadinessSummary["owners"][number]["owner"];
}) {
  return request<MarkdownDocumentResponse>(`/admin/runtime-readiness/env-handoff/${input.owner}`, {
    accessToken: input.accessToken
  });
}

export async function fetchReleaseStatusReport(accessToken: string) {
  return request<MarkdownDocumentResponse>("/admin/release-status/report", {
    accessToken
  });
}

export async function fetchAdminSubmissionBundles(input: { accessToken: string; limit?: number }) {
  const limit = input.limit ?? 5;
  return request<{ items: SubmissionBundleSummary[] }>(`/admin/submission-bundles?limit=${limit}`, {
    accessToken: input.accessToken
  });
}

export async function fetchAdminSubmissionBundleDetail(input: { accessToken: string; bundleLabel: string }) {
  return request<SubmissionBundleDetail>(`/admin/submission-bundles/${encodeURIComponent(input.bundleLabel)}`, {
    accessToken: input.accessToken
  });
}

export async function fetchAdminSubmissionBundleRecommendation(accessToken: string) {
  return request<SubmissionBundleRecommendation>("/admin/submission-bundles/recommendation", {
    accessToken
  });
}

export async function fetchReleaseSubmissionDecision(accessToken: string) {
  return request<ReleaseSubmissionDecision>("/admin/release-status/decision", {
    accessToken
  });
}

export async function fetchNotifications(accessToken: string) {
  return request<{ items: NotificationRecord[] }>("/me/notifications", {
    accessToken
  });
}

export async function markNotificationRead(input: { accessToken: string; notificationId: string }) {
  return request<NotificationRecord>(`/me/notifications/${input.notificationId}/read`, {
    method: "POST",
    accessToken: input.accessToken,
    body: {}
  });
}

export async function fetchSupportFallbacks(accessToken: string) {
  return request<{ items: SupportFallbackRecord[] }>("/me/support-fallbacks", {
    accessToken
  });
}

export async function acknowledgeSupportFallback(input: { accessToken: string; fallbackId: string }) {
  return request<SupportFallbackRecord>(`/me/support-fallbacks/${input.fallbackId}/acknowledge`, {
    method: "POST",
    accessToken: input.accessToken,
    body: {}
  });
}

export async function connectNotificationStream(input: {
  accessToken: string;
  signal: AbortSignal;
  onNotifications(items: NotificationRecord[]): void;
  onError?(error: unknown): void;
}) {
  const response = await fetch(`${API_BASE_URL}/me/notifications/stream`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${input.accessToken}`
    },
    signal: input.signal
  });

  if (!response.ok || !response.body) {
    throw new ApiClientError("알림 스트림 연결에 실패했어요.", "NOTIFICATION_STREAM_FAILED");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!input.signal.aborted) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    buffer += decoder.decode(chunk.value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      separatorIndex = buffer.indexOf("\n\n");

      const lines = rawEvent.split("\n");
      const eventName = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n");

      if (eventName === "notifications" && data) {
        input.onNotifications(JSON.parse(data) as NotificationRecord[]);
      }

      if (eventName === "error" && data && input.onError) {
        input.onError(JSON.parse(data));
      }
    }
  }
}
