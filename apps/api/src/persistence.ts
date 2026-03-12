import { Pool, type PoolClient } from "pg";

import type {
  AppealReviewAction,
  ChatMessage,
  CommunityPost,
  EmergencyEventRecord,
  EnforcementEvidenceBundle,
  FaceAuthSession,
  NotificationRecord,
  PaymentLedgerEntry,
  PushDeliveryAttemptRecord,
  PushSubscriptionRecord,
  ReportRecord,
  ReviewRecord,
  SupportFallbackRecord,
  UserAppeal,
  UserEnforcementAction,
  WorkerHeartbeatRecord
} from "../../../packages/contracts/src/index.ts";

import type {
  AuditLogEntry,
  ChatRoom,
  DemoUser,
  InMemoryStore,
  JobCancellationRequest,
  LocationLog,
  PendingLoginState,
  ProofPhoto,
  ProofUploadSession,
  RefreshSession,
  StoredJob
} from "./store.ts";

export interface OutboxEventRecord {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  availableAt: string;
  claimedAt?: string;
  claimedBy?: string;
  claimExpiresAt?: string;
  processedAt?: string;
  resultPayload?: Record<string, unknown>;
}

export interface PendingPushDelivery {
  notification: NotificationRecord;
  subscription: PushSubscriptionRecord;
}

export interface PersistenceAdapter {
  hydrate(store: InMemoryStore): Promise<void>;
  withTransaction<T>(fn: (tx: PersistenceAdapter) => Promise<T>): Promise<T>;
  upsertUser(user: DemoUser): Promise<void>;
  upsertEnforcementAction(action: UserEnforcementAction): Promise<void>;
  upsertEvidenceBundle(bundle: EnforcementEvidenceBundle): Promise<void>;
  upsertAppeal(appeal: UserAppeal): Promise<void>;
  upsertAppealReviewAction(action: AppealReviewAction): Promise<void>;
  upsertJob(job: StoredJob): Promise<void>;
  upsertPayment(payment: PaymentLedgerEntry): Promise<void>;
  upsertReport(report: ReportRecord): Promise<void>;
  upsertEmergency(emergency: EmergencyEventRecord): Promise<void>;
  appendLocationLog(log: LocationLog): Promise<void>;
  upsertProofUploadSession(session: ProofUploadSession): Promise<void>;
  upsertProofPhoto(photo: ProofPhoto): Promise<void>;
  upsertJobCancellationRequest(request: JobCancellationRequest): Promise<void>;
  upsertIdempotency(key: string, payload: unknown): Promise<void>;
  upsertLoginState(state: PendingLoginState): Promise<void>;
  deleteLoginState(state: string): Promise<void>;
  upsertRefreshSession(token: string, session: RefreshSession): Promise<void>;
  deleteRefreshSession(token: string): Promise<void>;
  upsertFaceAuthSession(session: FaceAuthSession): Promise<void>;
  deleteFaceAuthSession(faceAuthSessionId: string): Promise<void>;
  upsertChatRoom(room: ChatRoom): Promise<void>;
  appendChatMessage(message: ChatMessage): Promise<void>;
  upsertReview(review: ReviewRecord): Promise<void>;
  upsertCommunityPost(post: CommunityPost): Promise<void>;
  upsertNotification(notification: NotificationRecord): Promise<void>;
  listNotificationsByUser(userId: string): Promise<NotificationRecord[] | null>;
  markNotificationRead(notificationId: string, userId: string, readAt: string): Promise<void>;
  upsertPushSubscription(subscription: PushSubscriptionRecord): Promise<void>;
  listPushSubscriptionsByUser(userId: string): Promise<PushSubscriptionRecord[] | null>;
  listPushSubscriptions(limit: number): Promise<PushSubscriptionRecord[] | null>;
  disablePushSubscription(subscriptionId: string, userId: string, disabledAt: string): Promise<void>;
  appendPushDeliveryAttempt(attempt: PushDeliveryAttemptRecord): Promise<void>;
  listPushDeliveryAttempts(limit: number): Promise<PushDeliveryAttemptRecord[] | null>;
  listPendingPushDeliveries(limit: number): Promise<PendingPushDelivery[]>;
  upsertSupportFallback(fallback: SupportFallbackRecord): Promise<void>;
  listSupportFallbacksByUser(userId: string): Promise<SupportFallbackRecord[] | null>;
  listSupportFallbacks(limit: number): Promise<SupportFallbackRecord[] | null>;
  acknowledgeSupportFallback(fallbackId: string, userId: string, acknowledgedAt: string): Promise<void>;
  upsertWorkerHeartbeat(heartbeat: WorkerHeartbeatRecord): Promise<void>;
  listWorkerHeartbeats(): Promise<WorkerHeartbeatRecord[] | null>;
  enqueueOutboxEvent(event: Omit<OutboxEventRecord, "processedAt" | "resultPayload">): Promise<void>;
  claimOutboxEvents(limit: number, workerId: string, leaseSeconds: number): Promise<OutboxEventRecord[]>;
  markOutboxEventProcessed(eventId: string, workerId: string, resultPayload?: Record<string, unknown>): Promise<void>;
  appendAuditLog(entry: AuditLogEntry): Promise<void>;
  close(): Promise<void>;
}

export class NoopPersistenceAdapter implements PersistenceAdapter {
  async hydrate(_store: InMemoryStore) {}
  async withTransaction<T>(fn: (tx: PersistenceAdapter) => Promise<T>) { return fn(this); }
  async upsertUser(_user: DemoUser) {}
  async upsertEnforcementAction(_action: UserEnforcementAction) {}
  async upsertEvidenceBundle(_bundle: EnforcementEvidenceBundle) {}
  async upsertAppeal(_appeal: UserAppeal) {}
  async upsertAppealReviewAction(_action: AppealReviewAction) {}
  async upsertJob(_job: StoredJob) {}
  async upsertPayment(_payment: PaymentLedgerEntry) {}
  async upsertReport(_report: ReportRecord) {}
  async upsertEmergency(_emergency: EmergencyEventRecord) {}
  async appendLocationLog(_log: LocationLog) {}
  async upsertProofUploadSession(_session: ProofUploadSession) {}
  async upsertProofPhoto(_photo: ProofPhoto) {}
  async upsertJobCancellationRequest(_request: JobCancellationRequest) {}
  async upsertIdempotency(_key: string, _payload: unknown) {}
  async upsertLoginState(_state: PendingLoginState) {}
  async deleteLoginState(_state: string) {}
  async upsertRefreshSession(_token: string, _session: RefreshSession) {}
  async deleteRefreshSession(_token: string) {}
  async upsertFaceAuthSession(_session: FaceAuthSession) {}
  async deleteFaceAuthSession(_faceAuthSessionId: string) {}
  async upsertChatRoom(_room: ChatRoom) {}
  async appendChatMessage(_message: ChatMessage) {}
  async upsertReview(_review: ReviewRecord) {}
  async upsertCommunityPost(_post: CommunityPost) {}
  async upsertNotification(_notification: NotificationRecord) {}
  async listNotificationsByUser(_userId: string) { return null; }
  async markNotificationRead(_notificationId: string, _userId: string, _readAt: string) {}
  async upsertPushSubscription(_subscription: PushSubscriptionRecord) {}
  async listPushSubscriptionsByUser(_userId: string) { return null; }
  async listPushSubscriptions(_limit: number) { return null; }
  async disablePushSubscription(_subscriptionId: string, _userId: string, _disabledAt: string) {}
  async appendPushDeliveryAttempt(_attempt: PushDeliveryAttemptRecord) {}
  async listPushDeliveryAttempts(_limit: number) { return null; }
  async listPendingPushDeliveries(_limit: number) { return []; }
  async upsertSupportFallback(_fallback: SupportFallbackRecord) {}
  async listSupportFallbacksByUser(_userId: string) { return null; }
  async listSupportFallbacks(_limit: number) { return null; }
  async acknowledgeSupportFallback(_fallbackId: string, _userId: string, _acknowledgedAt: string) {}
  async upsertWorkerHeartbeat(_heartbeat: WorkerHeartbeatRecord) {}
  async listWorkerHeartbeats() { return null; }
  async enqueueOutboxEvent(_event: Omit<OutboxEventRecord, "processedAt" | "resultPayload">) {}
  async claimOutboxEvents(_limit: number, _workerId: string, _leaseSeconds: number) { return []; }
  async markOutboxEventProcessed(_eventId: string, _workerId: string, _resultPayload?: Record<string, unknown>) {}
  async appendAuditLog(_entry: AuditLogEntry) {}
  async close() {}
}

export class PostgresPersistenceAdapter implements PersistenceAdapter {
  private readonly pool: Pool;
  private readonly queryRunner: Pick<Pool, "query"> | Pick<PoolClient, "query">;
  private readonly ownsPool: boolean;

  constructor(connection: string | Pool, queryRunner?: Pick<Pool, "query"> | Pick<PoolClient, "query">) {
    if (typeof connection === "string") {
      this.pool = new Pool({
        connectionString: connection
      });
      this.ownsPool = true;
    } else {
      this.pool = connection;
      this.ownsPool = false;
    }

    this.queryRunner = queryRunner ?? this.pool;
  }

  async withTransaction<T>(fn: (tx: PersistenceAdapter) => Promise<T>) {
    if (!this.ownsPool) {
      return fn(this);
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const transactionalAdapter = new PostgresPersistenceAdapter(this.pool, client);
      const result = await fn(transactionalAdapter);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async hydrate(store: InMemoryStore) {
    for (const user of store.users.values()) {
      await this.upsertUser(user);
    }
    for (const review of store.reviews.values()) {
      await this.upsertReview(review);
    }
    for (const post of store.communityPosts.values()) {
      await this.upsertCommunityPost(post);
    }

    const usersResult = await this.queryRunner.query(`
      select
        user_id,
        ci_hash,
        toss_user_key,
        nickname,
        adult_verified,
        status,
        role_flags,
        safety_acknowledged_at,
        runner_verified,
        risk_score,
        transport_mode,
        vehicle_tier,
        business_verified,
        payout_account_verified,
        active_jobs,
        last_active_at,
        restriction_source,
        restriction_reason_code,
        restriction_reason_message,
        restriction_scope,
        restriction_review_status,
        restriction_action_id,
        restriction_updated_at,
        withdrawn_at
      from users
    `);

    store.users = new Map(
      usersResult.rows.map((row) => [
        row.user_id,
        {
          userId: row.user_id,
          ciHash: row.ci_hash,
          tossUserKey: row.toss_user_key ?? undefined,
          nickname: row.nickname,
          adultVerified: row.adult_verified,
          status: row.status,
          roleFlags: row.role_flags ?? [],
          safetyAcknowledgedAt: row.safety_acknowledged_at?.toISOString?.() ?? row.safety_acknowledged_at ?? undefined,
          runnerVerified: row.runner_verified,
          riskScore: row.risk_score,
          transportMode: row.transport_mode ?? undefined,
          vehicleTier: row.vehicle_tier ?? undefined,
          businessVerified: row.business_verified,
          payoutAccountVerified: row.payout_account_verified,
          activeJobs: row.active_jobs,
          lastActiveAt: row.last_active_at?.toISOString?.() ?? row.last_active_at,
          restriction:
            row.restriction_reason_code && row.restriction_reason_message && row.restriction_scope && row.restriction_review_status
              ? {
                  status: row.status,
                  reasonCode: row.restriction_reason_code,
                  reasonMessage: row.restriction_reason_message,
                  source: row.restriction_source,
                  scope: row.restriction_scope,
                  reviewStatus: row.restriction_review_status,
                  updatedAt: row.restriction_updated_at?.toISOString?.() ?? row.restriction_updated_at,
                  actionId: row.restriction_action_id ?? undefined,
                  supportAction: "KAKAO_CHANNEL"
                }
              : undefined,
          withdrawnAt: row.withdrawn_at?.toISOString?.() ?? row.withdrawn_at ?? undefined
        }
      ])
    );

    const evidenceRows = await this.queryRunner.query(`
      select evidence_bundle_id, user_id, source_action_id, evidence_type, summary, metadata, created_at
      from enforcement_evidence_bundles
    `);
    store.enforcementEvidenceBundles = new Map(
      evidenceRows.rows.map((row) => [
        row.evidence_bundle_id,
        {
          evidenceBundleId: row.evidence_bundle_id,
          userId: row.user_id,
          sourceActionId: row.source_action_id,
          evidenceType: row.evidence_type,
          summary: row.summary,
          metadata: row.metadata ?? undefined,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at
        }
      ])
    );

    const actionRows = await this.queryRunner.query(`
      select
        action_id, user_id, status_applied, source, scope, review_status,
        reason_code, reason_message, appeal_eligible, evidence_bundle_id, created_at, lifted_at, lifted_by_action_id
      from user_enforcement_actions
    `);
    store.userEnforcementActions = new Map(
      actionRows.rows.map((row) => [
        row.action_id,
        {
          actionId: row.action_id,
          userId: row.user_id,
          statusApplied: row.status_applied,
          source: row.source,
          scope: row.scope,
          reviewStatus: row.review_status,
          reasonCode: row.reason_code,
          reasonMessage: row.reason_message,
          appealEligible: row.appeal_eligible,
          evidenceBundleId: row.evidence_bundle_id,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at,
          liftedAt: row.lifted_at?.toISOString?.() ?? row.lifted_at ?? undefined,
          liftedByActionId: row.lifted_by_action_id ?? undefined
        }
      ])
    );

    const appealRows = await this.queryRunner.query(`
      select appeal_id, user_id, action_id, appeal_text, status, submitted_at, last_updated_at
      from user_appeals
    `);
    store.userAppeals = new Map(
      appealRows.rows.map((row) => [
        row.appeal_id,
        {
          appealId: row.appeal_id,
          userId: row.user_id,
          actionId: row.action_id,
          appealText: row.appeal_text,
          status: row.status,
          submittedAt: row.submitted_at?.toISOString?.() ?? row.submitted_at,
          lastUpdatedAt: row.last_updated_at?.toISOString?.() ?? row.last_updated_at
        }
      ])
    );

    const appealReviewRows = await this.queryRunner.query(`
      select review_action_id, appeal_id, action_id, reviewer_user_id, decision, note, created_at
      from appeal_review_actions
    `);
    store.appealReviewActions = new Map(
      appealReviewRows.rows.map((row) => [
        row.review_action_id,
        {
          reviewActionId: row.review_action_id,
          appealId: row.appeal_id,
          actionId: row.action_id,
          reviewerUserId: row.reviewer_user_id,
          decision: row.decision,
          note: row.note ?? undefined,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at
        }
      ])
    );

    const auditRows = await this.queryRunner.query(`
      select audit_id, actor_user_id, action, entity_type, entity_id, note, before_payload, after_payload, created_at
      from audit_logs
      order by created_at asc
    `);
    store.auditLogs = auditRows.rows.map((row) => ({
      auditId: row.audit_id,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      note: row.note ?? undefined,
      before: row.before_payload ?? undefined,
      after: row.after_payload ?? undefined,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at
    }));

    const jobRows = await this.queryRunner.query(`
      select
        job_id, client_user_id, title, description, pickup, dropoff, transport_requirement, vehicle_tier_required,
        offer_amount, requested_start_at, attachments, urgent, status, risk_level, requires_manual_review,
        payment_init_required, matched_runner_user_id, chat_room_id, has_report, has_dispute, client_confirmed,
        auto_confirm_expired
      from jobs
    `);
    store.jobs = new Map(
      jobRows.rows.map((row) => [
        row.job_id,
        {
          jobId: row.job_id,
          clientUserId: row.client_user_id,
          title: row.title,
          description: row.description,
          pickup: row.pickup,
          dropoff: row.dropoff,
          transportRequirement: row.transport_requirement,
          vehicleTierRequired: row.vehicle_tier_required ?? undefined,
          offerAmount: row.offer_amount,
          requestedStartAt: row.requested_start_at?.toISOString?.() ?? row.requested_start_at ?? undefined,
          attachments: row.attachments ?? [],
          urgent: row.urgent,
          status: row.status,
          riskLevel: row.risk_level,
          requiresManualReview: row.requires_manual_review,
          paymentInitRequired: row.payment_init_required,
          matchedRunnerUserId: row.matched_runner_user_id ?? undefined,
          chatRoomId: row.chat_room_id ?? undefined,
          hasReport: row.has_report,
          hasDispute: row.has_dispute,
          clientConfirmed: row.client_confirmed,
          autoConfirmExpired: row.auto_confirm_expired
        }
      ])
    );

    const paymentRows = await this.queryRunner.query(`
      select payment_id, job_id, user_id, order_id, status, amount_total, held_amount, fee_amount, pay_token, transaction_id, provider_payment_method, provider_status, refundable_amount, approved_at
      from payments
    `);
    store.payments = new Map(
      paymentRows.rows.map((row) => [
        row.payment_id,
        {
          paymentId: row.payment_id,
          jobId: row.job_id,
          userId: row.user_id,
          orderId: row.order_id,
          status: row.status,
          amountTotal: row.amount_total,
          heldAmount: row.held_amount,
          feeAmount: row.fee_amount,
          payToken: row.pay_token ?? undefined,
          transactionId: row.transaction_id ?? undefined,
          providerPaymentMethod: row.provider_payment_method ?? undefined,
          providerStatus: row.provider_status ?? undefined,
          refundableAmount: row.refundable_amount ?? undefined,
          approvedAt: row.approved_at?.toISOString?.() ?? row.approved_at ?? undefined
        }
      ])
    );

    const reportRows = await this.queryRunner.query(`
      select report_id, job_id, reporter_user_id, target_user_id, report_type, detail, created_at
      from reports
    `);
    store.reports = new Map(
      reportRows.rows.map((row) => [
        row.report_id,
        {
          reportId: row.report_id,
          jobId: row.job_id ?? undefined,
          reporterUserId: row.reporter_user_id,
          targetUserId: row.target_user_id,
          reportType: row.report_type,
          detail: row.detail ?? undefined,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at
        }
      ])
    );

    const emergencyRows = await this.queryRunner.query(`
      select emergency_event_id, job_id, event_type, lat, lng, created_at
      from emergencies
    `);
    store.emergencies = new Map(
      emergencyRows.rows.map((row) => [
        row.emergency_event_id,
        {
          emergencyEventId: row.emergency_event_id,
          jobId: row.job_id,
          eventType: row.event_type,
          lat: row.lat,
          lng: row.lng,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at
        }
      ])
    );

    const locationRows = await this.queryRunner.query(`
      select job_id, user_id, role, lat, lng, accuracy, source, logged_at
      from location_logs
      order by logged_at asc
    `);
    store.locationLogs = locationRows.rows.map((row) => ({
      jobId: row.job_id,
      userId: row.user_id,
      role: row.role,
      lat: row.lat,
      lng: row.lng,
      accuracy: row.accuracy,
      source: row.source,
      loggedAt: row.logged_at?.toISOString?.() ?? row.logged_at
    }));

    const proofRows = await this.queryRunner.query(`
      select proof_id, job_id, uploaded_by, proof_type, s3_key, watermarked_url, created_at
      from proof_photos
      order by created_at asc
    `);
    store.proofPhotos = proofRows.rows.map((row) => ({
      proofId: row.proof_id,
      jobId: row.job_id,
      uploadedBy: row.uploaded_by,
      proofType: row.proof_type,
      s3Key: row.s3_key,
      watermarkedUrl: row.watermarked_url,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at
    }));

    const proofUploadSessionRows = await this.queryRunner.query(`
      select
        upload_session_id, job_id, user_id, proof_type, source, object_key, status,
        local_asset_path, mime_type, image_id, created_at, expires_at, uploaded_at, completed_at
      from proof_upload_sessions
      order by created_at asc
    `);
    store.proofUploadSessions = new Map(
      proofUploadSessionRows.rows.map((row) => [
        row.upload_session_id,
        {
          uploadSessionId: row.upload_session_id,
          jobId: row.job_id,
          userId: row.user_id,
          proofType: row.proof_type,
          source: row.source,
          objectKey: row.object_key,
          status: row.status,
          localAssetPath: row.local_asset_path ?? undefined,
          mimeType: row.mime_type ?? undefined,
          imageId: row.image_id ?? undefined,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at,
          expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at,
          uploadedAt: row.uploaded_at?.toISOString?.() ?? row.uploaded_at,
          completedAt: row.completed_at?.toISOString?.() ?? row.completed_at
        }
      ])
    );

    const jobCancellationRows = await this.queryRunner.query(`
      select
        cancellation_request_id, job_id, requested_by_user_id, requester_role, reason,
        status, requested_at, responded_at, response_by_user_id, response_note, refund_reason_normalized
      from job_cancellation_requests
      order by requested_at asc
    `);
    store.jobCancellationRequests = new Map(
      jobCancellationRows.rows.map((row) => [
        row.cancellation_request_id,
        {
          cancellationRequestId: row.cancellation_request_id,
          jobId: row.job_id,
          requestedByUserId: row.requested_by_user_id,
          requesterRole: row.requester_role,
          reason: row.reason,
          status: row.status,
          requestedAt: row.requested_at?.toISOString?.() ?? row.requested_at,
          respondedAt: row.responded_at?.toISOString?.() ?? row.responded_at ?? undefined,
          responseByUserId: row.response_by_user_id ?? undefined,
          responseNote: row.response_note ?? undefined,
          refundReasonNormalized: row.refund_reason_normalized ?? undefined
        }
      ])
    );

    const idempotencyRows = await this.queryRunner.query(`
      select cache_key, payload
      from idempotency_cache
    `);
    store.idempotency = new Map();
    for (const row of idempotencyRows.rows) {
      store.idempotency.set(row.cache_key, row.payload);
    }

    const loginStateRows = await this.queryRunner.query(`
      select state, created_at, expires_at
      from login_states
    `);
    store.loginStates = new Map(
      loginStateRows.rows.map((row) => [
        row.state,
        {
          state: row.state,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at,
          expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at
        }
      ])
    );

    const refreshRows = await this.queryRunner.query(`
      select refresh_token, user_id, issued_at, expires_at
      from refresh_sessions
    `);
    store.refreshSessions = new Map(
      refreshRows.rows.map((row) => [
        row.refresh_token,
        {
          userId: row.user_id,
          issuedAt: row.issued_at?.toISOString?.() ?? row.issued_at,
          expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at
        }
      ])
    );

    const faceAuthRows = await this.queryRunner.query(`
      select
        face_auth_session_id, user_id, job_draft_id, intent, provider, provider_request_id, request_url, tx_id,
        toss_face_tx_id, verified_at, consumed_at, expires_at
      from face_auth_sessions
    `);
    store.faceAuthSessions = new Map(
      faceAuthRows.rows.map((row) => [
        row.face_auth_session_id,
        {
          faceAuthSessionId: row.face_auth_session_id,
          userId: row.user_id,
          jobDraftId: row.job_draft_id ?? undefined,
          intent: row.intent,
          provider: row.provider,
          providerRequestId: row.provider_request_id ?? undefined,
          requestUrl: row.request_url ?? undefined,
          txId: row.tx_id ?? undefined,
          tossFaceTxId: row.toss_face_tx_id ?? undefined,
          verifiedAt: row.verified_at?.toISOString?.() ?? row.verified_at ?? undefined,
          consumedAt: row.consumed_at?.toISOString?.() ?? row.consumed_at ?? undefined,
          expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at
        }
      ])
    );

    const roomRows = await this.queryRunner.query(`
      select room_id, job_id, status, created_at
      from chat_rooms
    `);
    store.chatRooms = new Map(
      roomRows.rows.map((row) => [
        row.room_id,
        {
          roomId: row.room_id,
          jobId: row.job_id,
          status: row.status,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at
        }
      ])
    );

    const messageRows = await this.queryRunner.query(`
      select message_id, room_id, sender_user_id, message_type, body, moderation_status, action_taken, created_at
      from chat_messages
      order by created_at asc
    `);
    store.chatMessages = new Map();
    for (const row of messageRows.rows) {
      const existing = store.chatMessages.get(row.room_id) ?? [];
      existing.push({
        messageId: row.message_id,
        roomId: row.room_id,
        senderUserId: row.sender_user_id,
        messageType: row.message_type,
        body: row.body,
        moderationStatus: row.moderation_status,
        actionTaken: row.action_taken,
        createdAt: row.created_at?.toISOString?.() ?? row.created_at
      });
      store.chatMessages.set(row.room_id, existing);
    }

    const reviewRows = await this.queryRunner.query(`
      select review_id, job_id, author_user_id, target_user_id, rating_value, body, created_at
      from reviews
      order by created_at asc
    `);
    store.reviews = new Map(
      reviewRows.rows.map((row) => [
        row.review_id,
        {
          reviewId: row.review_id,
          jobId: row.job_id,
          authorUserId: row.author_user_id,
          targetUserId: row.target_user_id,
          ratingValue: row.rating_value,
          body: row.body,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at
        }
      ])
    );

    const communityRows = await this.queryRunner.query(`
      select post_id, author_user_id, title, body, image_url, created_at
      from community_posts
      order by created_at asc
    `);
    store.communityPosts = new Map(
      communityRows.rows.map((row) => [
        row.post_id,
        {
          postId: row.post_id,
          authorUserId: row.author_user_id,
          title: row.title,
          body: row.body,
          imageUrl: row.image_url ?? undefined,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at
        }
      ])
    );

    const notificationRows = await this.queryRunner.query(`
      select
        notification_id, user_id, channel, category, title, body, deep_link,
        related_entity_type, related_entity_id, triggered_by_event_id, created_at, read_at
      from notifications
      order by created_at desc
    `);
    store.notifications = new Map(
      notificationRows.rows.map((row) => [
        row.notification_id,
        {
          notificationId: row.notification_id,
          userId: row.user_id,
          channel: row.channel,
          category: row.category,
          title: row.title,
          body: row.body,
          deepLink: row.deep_link ?? undefined,
          relatedEntityType: row.related_entity_type ?? undefined,
          relatedEntityId: row.related_entity_id ?? undefined,
          triggeredByEventId: row.triggered_by_event_id,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at,
          readAt: row.read_at?.toISOString?.() ?? row.read_at ?? undefined
        }
      ])
    );

    const pushSubscriptionRows = await this.queryRunner.query(`
      select
        subscription_id, user_id, provider, endpoint, auth_secret, p256dh, device_label,
        created_at, last_seen_at, disabled_at, failure_count
      from push_subscriptions
      order by last_seen_at desc
    `);
    store.pushSubscriptions = new Map(
      pushSubscriptionRows.rows.map((row) => [
        row.subscription_id,
        {
          subscriptionId: row.subscription_id,
          userId: row.user_id,
          provider: row.provider,
          endpoint: row.endpoint,
          authSecret: row.auth_secret ?? undefined,
          p256dh: row.p256dh ?? undefined,
          deviceLabel: row.device_label ?? undefined,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at,
          lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at,
          disabledAt: row.disabled_at?.toISOString?.() ?? row.disabled_at ?? undefined,
          failureCount: row.failure_count
        }
      ])
    );

    const pushAttemptRows = await this.queryRunner.query(`
      select
        delivery_attempt_id, notification_id, subscription_id, provider, status, attempted_at,
        provider_message_id, error_message
      from push_delivery_attempts
      order by attempted_at desc
    `);
    store.pushDeliveryAttempts = new Map(
      pushAttemptRows.rows.map((row) => [
        row.delivery_attempt_id,
        {
          deliveryAttemptId: row.delivery_attempt_id,
          notificationId: row.notification_id,
          subscriptionId: row.subscription_id,
          provider: row.provider,
          status: row.status,
          attemptedAt: row.attempted_at?.toISOString?.() ?? row.attempted_at,
          providerMessageId: row.provider_message_id ?? undefined,
          errorMessage: row.error_message ?? undefined
        }
      ])
    );

    const supportFallbackRows = await this.queryRunner.query(`
      select
        fallback_id, user_id, source_notification_id, channel, status, reason_code, reason_message,
        created_at, acknowledged_at
      from support_fallbacks
      order by created_at desc
    `);
    store.supportFallbacks = new Map(
      supportFallbackRows.rows.map((row) => [
        row.fallback_id,
        {
          fallbackId: row.fallback_id,
          userId: row.user_id,
          sourceNotificationId: row.source_notification_id,
          channel: row.channel,
          status: row.status,
          reasonCode: row.reason_code,
          reasonMessage: row.reason_message,
          createdAt: row.created_at?.toISOString?.() ?? row.created_at,
          acknowledgedAt: row.acknowledged_at?.toISOString?.() ?? row.acknowledged_at ?? undefined
        }
      ])
    );

    const workerHeartbeatRows = await this.queryRunner.query(`
      select worker_key, last_started_at, last_completed_at, last_status, last_summary
      from worker_heartbeats
      order by worker_key asc
    `);
    store.workerHeartbeats = new Map(
      workerHeartbeatRows.rows.map((row) => [
        row.worker_key,
        {
          workerKey: row.worker_key,
          lastStartedAt: row.last_started_at?.toISOString?.() ?? row.last_started_at,
          lastCompletedAt: row.last_completed_at?.toISOString?.() ?? row.last_completed_at ?? undefined,
          lastStatus: row.last_status,
          lastSummary: row.last_summary ?? undefined
        }
      ])
    );
  }

  async upsertUser(user: DemoUser) {
    await this.queryRunner.query(
      `
        insert into users (
          user_id, ci_hash, toss_user_key, nickname, adult_verified, status, role_flags, safety_acknowledged_at,
          runner_verified, risk_score, transport_mode, vehicle_tier, business_verified,
          payout_account_verified, active_jobs, last_active_at,
          restriction_source,
          restriction_reason_code, restriction_reason_message, restriction_scope,
          restriction_review_status, restriction_action_id, restriction_updated_at, withdrawn_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22, $23, $24
        )
        on conflict (user_id) do update set
          ci_hash = excluded.ci_hash,
          toss_user_key = excluded.toss_user_key,
          nickname = excluded.nickname,
          adult_verified = excluded.adult_verified,
          status = excluded.status,
          role_flags = excluded.role_flags,
          safety_acknowledged_at = excluded.safety_acknowledged_at,
          runner_verified = excluded.runner_verified,
          risk_score = excluded.risk_score,
          transport_mode = excluded.transport_mode,
          vehicle_tier = excluded.vehicle_tier,
          business_verified = excluded.business_verified,
          payout_account_verified = excluded.payout_account_verified,
          active_jobs = excluded.active_jobs,
          last_active_at = excluded.last_active_at,
          restriction_source = excluded.restriction_source,
          restriction_reason_code = excluded.restriction_reason_code,
          restriction_reason_message = excluded.restriction_reason_message,
          restriction_scope = excluded.restriction_scope,
          restriction_review_status = excluded.restriction_review_status,
          restriction_action_id = excluded.restriction_action_id,
          restriction_updated_at = excluded.restriction_updated_at,
          withdrawn_at = excluded.withdrawn_at
      `,
      [
        user.userId,
        user.ciHash,
        user.tossUserKey ?? null,
        user.nickname,
        user.adultVerified,
        user.status,
        user.roleFlags,
        user.safetyAcknowledgedAt ?? null,
        user.runnerVerified,
        user.riskScore,
        user.transportMode ?? null,
        user.vehicleTier ?? null,
        user.businessVerified,
        user.payoutAccountVerified,
        user.activeJobs,
        user.lastActiveAt,
        user.restriction?.source ?? null,
        user.restriction?.reasonCode ?? null,
        user.restriction?.reasonMessage ?? null,
        user.restriction?.scope ?? null,
        user.restriction?.reviewStatus ?? null,
        user.restriction?.actionId ?? null,
        user.restriction?.updatedAt ?? null,
        user.withdrawnAt ?? null
      ]
    );
  }

  async upsertEnforcementAction(action: UserEnforcementAction) {
    await this.queryRunner.query(
      `
        insert into user_enforcement_actions (
          action_id, user_id, status_applied, source, scope, review_status, reason_code, reason_message,
          appeal_eligible, evidence_bundle_id, created_at, lifted_at, lifted_by_action_id
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13
        )
        on conflict (action_id) do update set
          status_applied = excluded.status_applied,
          source = excluded.source,
          scope = excluded.scope,
          review_status = excluded.review_status,
          reason_code = excluded.reason_code,
          reason_message = excluded.reason_message,
          appeal_eligible = excluded.appeal_eligible,
          evidence_bundle_id = excluded.evidence_bundle_id,
          created_at = excluded.created_at,
          lifted_at = excluded.lifted_at,
          lifted_by_action_id = excluded.lifted_by_action_id
      `,
      [
        action.actionId,
        action.userId,
        action.statusApplied,
        action.source,
        action.scope,
        action.reviewStatus,
        action.reasonCode,
        action.reasonMessage,
        action.appealEligible,
        action.evidenceBundleId,
        action.createdAt,
        action.liftedAt ?? null,
        action.liftedByActionId ?? null
      ]
    );
  }

  async upsertEvidenceBundle(bundle: EnforcementEvidenceBundle) {
    await this.queryRunner.query(
      `
        insert into enforcement_evidence_bundles (
          evidence_bundle_id, user_id, source_action_id, evidence_type, summary, metadata, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (evidence_bundle_id) do update set
          user_id = excluded.user_id,
          source_action_id = excluded.source_action_id,
          evidence_type = excluded.evidence_type,
          summary = excluded.summary,
          metadata = excluded.metadata,
          created_at = excluded.created_at
      `,
      [bundle.evidenceBundleId, bundle.userId, bundle.sourceActionId, bundle.evidenceType, bundle.summary, bundle.metadata ?? null, bundle.createdAt]
    );
  }

  async upsertAppeal(appeal: UserAppeal) {
    await this.queryRunner.query(
      `
        insert into user_appeals (
          appeal_id, user_id, action_id, appeal_text, status, submitted_at, last_updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (appeal_id) do update set
          action_id = excluded.action_id,
          appeal_text = excluded.appeal_text,
          status = excluded.status,
          submitted_at = excluded.submitted_at,
          last_updated_at = excluded.last_updated_at
      `,
      [appeal.appealId, appeal.userId, appeal.actionId, appeal.appealText, appeal.status, appeal.submittedAt, appeal.lastUpdatedAt]
    );
  }

  async upsertAppealReviewAction(action: AppealReviewAction) {
    await this.queryRunner.query(
      `
        insert into appeal_review_actions (
          review_action_id, appeal_id, action_id, reviewer_user_id, decision, note, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (review_action_id) do update set
          appeal_id = excluded.appeal_id,
          action_id = excluded.action_id,
          reviewer_user_id = excluded.reviewer_user_id,
          decision = excluded.decision,
          note = excluded.note,
          created_at = excluded.created_at
      `,
      [action.reviewActionId, action.appealId, action.actionId, action.reviewerUserId, action.decision, action.note ?? null, action.createdAt]
    );
  }

  async upsertJob(job: StoredJob) {
    await this.queryRunner.query(
      `
        insert into jobs (
          job_id, client_user_id, title, description, pickup, dropoff, transport_requirement, vehicle_tier_required,
          offer_amount, requested_start_at, attachments, urgent, status, risk_level, requires_manual_review,
          payment_init_required, matched_runner_user_id, chat_room_id, has_report, has_dispute, client_confirmed,
          auto_confirm_expired
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22
        )
        on conflict (job_id) do update set
          client_user_id = excluded.client_user_id,
          title = excluded.title,
          description = excluded.description,
          pickup = excluded.pickup,
          dropoff = excluded.dropoff,
          transport_requirement = excluded.transport_requirement,
          vehicle_tier_required = excluded.vehicle_tier_required,
          offer_amount = excluded.offer_amount,
          requested_start_at = excluded.requested_start_at,
          attachments = excluded.attachments,
          urgent = excluded.urgent,
          status = excluded.status,
          risk_level = excluded.risk_level,
          requires_manual_review = excluded.requires_manual_review,
          payment_init_required = excluded.payment_init_required,
          matched_runner_user_id = excluded.matched_runner_user_id,
          chat_room_id = excluded.chat_room_id,
          has_report = excluded.has_report,
          has_dispute = excluded.has_dispute,
          client_confirmed = excluded.client_confirmed,
          auto_confirm_expired = excluded.auto_confirm_expired
      `,
      [
        job.jobId,
        job.clientUserId,
        job.title,
        job.description,
        job.pickup,
        job.dropoff,
        job.transportRequirement,
        job.vehicleTierRequired ?? null,
        job.offerAmount,
        job.requestedStartAt ?? null,
        job.attachments ?? [],
        Boolean(job.urgent),
        job.status,
        job.riskLevel,
        job.requiresManualReview,
        job.paymentInitRequired,
        job.matchedRunnerUserId ?? null,
        job.chatRoomId ?? null,
        job.hasReport,
        job.hasDispute,
        job.clientConfirmed,
        job.autoConfirmExpired
      ]
    );
  }

  async upsertPayment(payment: PaymentLedgerEntry) {
    await this.queryRunner.query(
      `
        insert into payments (
          payment_id, job_id, user_id, order_id, status, amount_total, held_amount, fee_amount, pay_token, transaction_id,
          provider_payment_method, provider_status, refundable_amount, approved_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        on conflict (payment_id) do update set
          job_id = excluded.job_id,
          user_id = excluded.user_id,
          order_id = excluded.order_id,
          status = excluded.status,
          amount_total = excluded.amount_total,
          held_amount = excluded.held_amount,
          fee_amount = excluded.fee_amount,
          pay_token = excluded.pay_token,
          transaction_id = excluded.transaction_id,
          provider_payment_method = excluded.provider_payment_method,
          provider_status = excluded.provider_status,
          refundable_amount = excluded.refundable_amount,
          approved_at = excluded.approved_at
      `,
      [
        payment.paymentId,
        payment.jobId,
        payment.userId,
        payment.orderId,
        payment.status,
        payment.amountTotal,
        payment.heldAmount,
        payment.feeAmount,
        payment.payToken ?? null,
        payment.transactionId ?? null,
        payment.providerPaymentMethod ?? null,
        payment.providerStatus ?? null,
        payment.refundableAmount ?? null,
        payment.approvedAt ?? null
      ]
    );
  }

  async upsertReport(report: ReportRecord) {
    await this.queryRunner.query(
      `
        insert into reports (
          report_id, job_id, reporter_user_id, target_user_id, report_type, detail, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (report_id) do update set
          job_id = excluded.job_id,
          reporter_user_id = excluded.reporter_user_id,
          target_user_id = excluded.target_user_id,
          report_type = excluded.report_type,
          detail = excluded.detail,
          created_at = excluded.created_at
      `,
      [report.reportId, report.jobId ?? null, report.reporterUserId, report.targetUserId, report.reportType, report.detail ?? null, report.createdAt]
    );
  }

  async upsertEmergency(emergency: EmergencyEventRecord) {
    await this.queryRunner.query(
      `
        insert into emergencies (
          emergency_event_id, job_id, event_type, lat, lng, created_at
        ) values ($1, $2, $3, $4, $5, $6)
        on conflict (emergency_event_id) do update set
          job_id = excluded.job_id,
          event_type = excluded.event_type,
          lat = excluded.lat,
          lng = excluded.lng,
          created_at = excluded.created_at
      `,
      [emergency.emergencyEventId, emergency.jobId, emergency.eventType, emergency.lat, emergency.lng, emergency.createdAt]
    );
  }

  async appendLocationLog(log: LocationLog) {
    await this.queryRunner.query(
      `
        insert into location_logs (
          job_id, user_id, role, lat, lng, accuracy, source, logged_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [log.jobId, log.userId, log.role, log.lat, log.lng, log.accuracy, log.source, log.loggedAt]
    );
  }

  async upsertProofUploadSession(session: ProofUploadSession) {
    await this.queryRunner.query(
      `
        insert into proof_upload_sessions (
          upload_session_id, job_id, user_id, proof_type, source, object_key, status,
          local_asset_path, mime_type, image_id, created_at, expires_at, uploaded_at, completed_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        on conflict (upload_session_id) do update set
          job_id = excluded.job_id,
          user_id = excluded.user_id,
          proof_type = excluded.proof_type,
          source = excluded.source,
          object_key = excluded.object_key,
          status = excluded.status,
          local_asset_path = excluded.local_asset_path,
          mime_type = excluded.mime_type,
          image_id = excluded.image_id,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          uploaded_at = excluded.uploaded_at,
          completed_at = excluded.completed_at
      `,
      [
        session.uploadSessionId,
        session.jobId,
        session.userId,
        session.proofType,
        session.source,
        session.objectKey,
        session.status,
        session.localAssetPath ?? null,
        session.mimeType ?? null,
        session.imageId ?? null,
        session.createdAt,
        session.expiresAt,
        session.uploadedAt ?? null,
        session.completedAt ?? null
      ]
    );
  }

  async upsertProofPhoto(photo: ProofPhoto) {
    await this.queryRunner.query(
      `
        insert into proof_photos (
          proof_id, job_id, uploaded_by, proof_type, s3_key, watermarked_url, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (proof_id) do update set
          job_id = excluded.job_id,
          uploaded_by = excluded.uploaded_by,
          proof_type = excluded.proof_type,
          s3_key = excluded.s3_key,
          watermarked_url = excluded.watermarked_url,
          created_at = excluded.created_at
      `,
      [photo.proofId, photo.jobId, photo.uploadedBy, photo.proofType, photo.s3Key, photo.watermarkedUrl, photo.createdAt]
    );
  }

  async upsertJobCancellationRequest(request: JobCancellationRequest) {
    await this.queryRunner.query(
      `
        insert into job_cancellation_requests (
          cancellation_request_id, job_id, requested_by_user_id, requester_role, reason,
          status, requested_at, responded_at, response_by_user_id, response_note, refund_reason_normalized
        ) values (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11
        )
        on conflict (cancellation_request_id) do update set
          job_id = excluded.job_id,
          requested_by_user_id = excluded.requested_by_user_id,
          requester_role = excluded.requester_role,
          reason = excluded.reason,
          status = excluded.status,
          requested_at = excluded.requested_at,
          responded_at = excluded.responded_at,
          response_by_user_id = excluded.response_by_user_id,
          response_note = excluded.response_note,
          refund_reason_normalized = excluded.refund_reason_normalized
      `,
      [
        request.cancellationRequestId,
        request.jobId,
        request.requestedByUserId,
        request.requesterRole,
        request.reason,
        request.status,
        request.requestedAt,
        request.respondedAt ?? null,
        request.responseByUserId ?? null,
        request.responseNote ?? null,
        request.refundReasonNormalized ?? null
      ]
    );
  }

  async upsertIdempotency(key: string, payload: unknown) {
    await this.queryRunner.query(
      `
        insert into idempotency_cache (cache_key, payload)
        values ($1, $2)
        on conflict (cache_key) do update set
          payload = excluded.payload
      `,
      [key, payload]
    );
  }

  async upsertLoginState(state: PendingLoginState) {
    await this.queryRunner.query(
      `
        insert into login_states (state, created_at, expires_at)
        values ($1, $2, $3)
        on conflict (state) do update set
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      `,
      [state.state, state.createdAt, state.expiresAt]
    );
  }

  async deleteLoginState(state: string) {
    await this.queryRunner.query("delete from login_states where state = $1", [state]);
  }

  async upsertRefreshSession(token: string, session: RefreshSession) {
    await this.queryRunner.query(
      `
        insert into refresh_sessions (refresh_token, user_id, issued_at, expires_at)
        values ($1, $2, $3, $4)
        on conflict (refresh_token) do update set
          user_id = excluded.user_id,
          issued_at = excluded.issued_at,
          expires_at = excluded.expires_at
      `,
      [token, session.userId, session.issuedAt, session.expiresAt]
    );
  }

  async deleteRefreshSession(token: string) {
    await this.queryRunner.query("delete from refresh_sessions where refresh_token = $1", [token]);
  }

  async upsertFaceAuthSession(session: FaceAuthSession) {
    await this.queryRunner.query(
      `
        insert into face_auth_sessions (
          face_auth_session_id, user_id, job_draft_id, intent, provider, provider_request_id, request_url, tx_id,
          toss_face_tx_id, verified_at, consumed_at, expires_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12
        )
        on conflict (face_auth_session_id) do update set
          user_id = excluded.user_id,
          job_draft_id = excluded.job_draft_id,
          intent = excluded.intent,
          provider = excluded.provider,
          provider_request_id = excluded.provider_request_id,
          request_url = excluded.request_url,
          tx_id = excluded.tx_id,
          toss_face_tx_id = excluded.toss_face_tx_id,
          verified_at = excluded.verified_at,
          consumed_at = excluded.consumed_at,
          expires_at = excluded.expires_at
      `,
      [
        session.faceAuthSessionId,
        session.userId,
        session.jobDraftId ?? null,
        session.intent,
        session.provider,
        session.providerRequestId ?? null,
        session.requestUrl ?? null,
        session.txId ?? null,
        session.tossFaceTxId ?? null,
        session.verifiedAt ?? null,
        session.consumedAt ?? null,
        session.expiresAt
      ]
    );
  }

  async deleteFaceAuthSession(faceAuthSessionId: string) {
    await this.queryRunner.query("delete from face_auth_sessions where face_auth_session_id = $1", [faceAuthSessionId]);
  }

  async upsertChatRoom(room: ChatRoom) {
    await this.queryRunner.query(
      `
        insert into chat_rooms (room_id, job_id, status, created_at)
        values ($1, $2, $3, $4)
        on conflict (room_id) do update set
          job_id = excluded.job_id,
          status = excluded.status,
          created_at = excluded.created_at
      `,
      [room.roomId, room.jobId, room.status, room.createdAt]
    );
  }

  async appendChatMessage(message: ChatMessage) {
    await this.queryRunner.query(
      `
        insert into chat_messages (
          message_id, room_id, sender_user_id, message_type, body, moderation_status, action_taken, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (message_id) do nothing
      `,
      [message.messageId, message.roomId, message.senderUserId, message.messageType, message.body, message.moderationStatus, message.actionTaken, message.createdAt]
    );
  }

  async upsertReview(review: ReviewRecord) {
    await this.queryRunner.query(
      `
        insert into reviews (
          review_id, job_id, author_user_id, target_user_id, rating_value, body, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (review_id) do update set
          job_id = excluded.job_id,
          author_user_id = excluded.author_user_id,
          target_user_id = excluded.target_user_id,
          rating_value = excluded.rating_value,
          body = excluded.body,
          created_at = excluded.created_at
      `,
      [review.reviewId, review.jobId, review.authorUserId, review.targetUserId, review.ratingValue, review.body, review.createdAt]
    );
  }

  async upsertCommunityPost(post: CommunityPost) {
    await this.queryRunner.query(
      `
        insert into community_posts (
          post_id, author_user_id, title, body, image_url, created_at
        ) values ($1, $2, $3, $4, $5, $6)
        on conflict (post_id) do update set
          author_user_id = excluded.author_user_id,
          title = excluded.title,
          body = excluded.body,
          image_url = excluded.image_url,
          created_at = excluded.created_at
      `,
      [post.postId, post.authorUserId, post.title, post.body, post.imageUrl ?? null, post.createdAt]
    );
  }

  async upsertNotification(notification: NotificationRecord) {
    await this.queryRunner.query(
      `
        insert into notifications (
          notification_id, user_id, channel, category, title, body, deep_link,
          related_entity_type, related_entity_id, triggered_by_event_id, created_at, read_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12
        )
        on conflict (notification_id) do update set
          user_id = excluded.user_id,
          channel = excluded.channel,
          category = excluded.category,
          title = excluded.title,
          body = excluded.body,
          deep_link = excluded.deep_link,
          related_entity_type = excluded.related_entity_type,
          related_entity_id = excluded.related_entity_id,
          triggered_by_event_id = excluded.triggered_by_event_id,
          created_at = excluded.created_at,
          read_at = excluded.read_at
      `,
      [
        notification.notificationId,
        notification.userId,
        notification.channel,
        notification.category,
        notification.title,
        notification.body,
        notification.deepLink ?? null,
        notification.relatedEntityType ?? null,
        notification.relatedEntityId ?? null,
        notification.triggeredByEventId,
        notification.createdAt,
        notification.readAt ?? null
      ]
    );
  }

  async listNotificationsByUser(userId: string) {
    const result = await this.queryRunner.query(
      `
        select
          notification_id, user_id, channel, category, title, body, deep_link,
          related_entity_type, related_entity_id, triggered_by_event_id, created_at, read_at
        from notifications
        where user_id = $1
        order by created_at desc
      `,
      [userId]
    );

    return result.rows.map((row) => ({
      notificationId: row.notification_id,
      userId: row.user_id,
      channel: row.channel,
      category: row.category,
      title: row.title,
      body: row.body,
      deepLink: row.deep_link ?? undefined,
      relatedEntityType: row.related_entity_type ?? undefined,
      relatedEntityId: row.related_entity_id ?? undefined,
      triggeredByEventId: row.triggered_by_event_id,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      readAt: row.read_at?.toISOString?.() ?? row.read_at ?? undefined
    }));
  }

  async markNotificationRead(notificationId: string, userId: string, readAt: string) {
    await this.queryRunner.query(
      `
        update notifications
        set read_at = $3
        where notification_id = $1
          and user_id = $2
      `,
      [notificationId, userId, readAt]
    );
  }

  async upsertPushSubscription(subscription: PushSubscriptionRecord) {
    await this.queryRunner.query(
      `
        insert into push_subscriptions (
          subscription_id, user_id, provider, endpoint, auth_secret, p256dh, device_label,
          created_at, last_seen_at, disabled_at, failure_count
        ) values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11
        )
        on conflict (subscription_id) do update set
          user_id = excluded.user_id,
          provider = excluded.provider,
          endpoint = excluded.endpoint,
          auth_secret = excluded.auth_secret,
          p256dh = excluded.p256dh,
          device_label = excluded.device_label,
          created_at = excluded.created_at,
          last_seen_at = excluded.last_seen_at,
          disabled_at = excluded.disabled_at,
          failure_count = excluded.failure_count
      `,
      [
        subscription.subscriptionId,
        subscription.userId,
        subscription.provider,
        subscription.endpoint,
        subscription.authSecret ?? null,
        subscription.p256dh ?? null,
        subscription.deviceLabel ?? null,
        subscription.createdAt,
        subscription.lastSeenAt,
        subscription.disabledAt ?? null,
        subscription.failureCount
      ]
    );
  }

  async listPushSubscriptionsByUser(userId: string) {
    const result = await this.queryRunner.query(
      `
        select
          subscription_id, user_id, provider, endpoint, auth_secret, p256dh, device_label,
          created_at, last_seen_at, disabled_at, failure_count
        from push_subscriptions
        where user_id = $1
        order by last_seen_at desc
      `,
      [userId]
    );

    return result.rows.map((row) => ({
      subscriptionId: row.subscription_id,
      userId: row.user_id,
      provider: row.provider,
      endpoint: row.endpoint,
      authSecret: row.auth_secret ?? undefined,
      p256dh: row.p256dh ?? undefined,
      deviceLabel: row.device_label ?? undefined,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at,
      disabledAt: row.disabled_at?.toISOString?.() ?? row.disabled_at ?? undefined,
      failureCount: row.failure_count
    }));
  }

  async listPushSubscriptions(limit: number) {
    const result = await this.queryRunner.query(
      `
        select
          subscription_id, user_id, provider, endpoint, auth_secret, p256dh, device_label,
          created_at, last_seen_at, disabled_at, failure_count
        from push_subscriptions
        order by last_seen_at desc
        limit $1
      `,
      [limit]
    );

    return result.rows.map((row) => ({
      subscriptionId: row.subscription_id,
      userId: row.user_id,
      provider: row.provider,
      endpoint: row.endpoint,
      authSecret: row.auth_secret ?? undefined,
      p256dh: row.p256dh ?? undefined,
      deviceLabel: row.device_label ?? undefined,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at,
      disabledAt: row.disabled_at?.toISOString?.() ?? row.disabled_at ?? undefined,
      failureCount: row.failure_count
    }));
  }

  async disablePushSubscription(subscriptionId: string, userId: string, disabledAt: string) {
    await this.queryRunner.query(
      `
        update push_subscriptions
        set disabled_at = $3
        where subscription_id = $1
          and user_id = $2
      `,
      [subscriptionId, userId, disabledAt]
    );
  }

  async appendPushDeliveryAttempt(attempt: PushDeliveryAttemptRecord) {
    await this.queryRunner.query(
      `
        insert into push_delivery_attempts (
          delivery_attempt_id, notification_id, subscription_id, provider, status, attempted_at,
          provider_message_id, error_message
        ) values (
          $1, $2, $3, $4, $5, $6,
          $7, $8
        )
        on conflict (delivery_attempt_id) do nothing
      `,
      [
        attempt.deliveryAttemptId,
        attempt.notificationId,
        attempt.subscriptionId,
        attempt.provider,
        attempt.status,
        attempt.attemptedAt,
        attempt.providerMessageId ?? null,
        attempt.errorMessage ?? null
      ]
    );
  }

  async listPushDeliveryAttempts(limit: number) {
    const result = await this.queryRunner.query(
      `
        select
          delivery_attempt_id, notification_id, subscription_id, provider, status, attempted_at,
          provider_message_id, error_message
        from push_delivery_attempts
        order by attempted_at desc
        limit $1
      `,
      [limit]
    );

    return result.rows.map((row) => ({
      deliveryAttemptId: row.delivery_attempt_id,
      notificationId: row.notification_id,
      subscriptionId: row.subscription_id,
      provider: row.provider,
      status: row.status,
      attemptedAt: row.attempted_at?.toISOString?.() ?? row.attempted_at,
      providerMessageId: row.provider_message_id ?? undefined,
      errorMessage: row.error_message ?? undefined
    }));
  }

  async listPendingPushDeliveries(limit: number) {
    const result = await this.queryRunner.query(
      `
        select
          notifications.notification_id,
          notifications.user_id,
          notifications.channel,
          notifications.category,
          notifications.title,
          notifications.body,
          notifications.deep_link,
          notifications.related_entity_type,
          notifications.related_entity_id,
          notifications.triggered_by_event_id,
          notifications.created_at,
          notifications.read_at,
          subscriptions.subscription_id,
          subscriptions.provider,
          subscriptions.endpoint,
          subscriptions.auth_secret,
          subscriptions.p256dh,
          subscriptions.device_label,
          subscriptions.created_at as subscription_created_at,
          subscriptions.last_seen_at,
          subscriptions.disabled_at,
          subscriptions.failure_count
        from notifications
        join push_subscriptions as subscriptions
          on subscriptions.user_id = notifications.user_id
        left join push_delivery_attempts as attempts
          on attempts.notification_id = notifications.notification_id
         and attempts.subscription_id = subscriptions.subscription_id
        where notifications.read_at is null
          and subscriptions.disabled_at is null
          and attempts.delivery_attempt_id is null
        order by notifications.created_at asc
        limit $1
      `,
      [limit]
    );

    return result.rows.map((row) => ({
      notification: {
        notificationId: row.notification_id,
        userId: row.user_id,
        channel: row.channel,
        category: row.category,
        title: row.title,
        body: row.body,
        deepLink: row.deep_link ?? undefined,
        relatedEntityType: row.related_entity_type ?? undefined,
        relatedEntityId: row.related_entity_id ?? undefined,
        triggeredByEventId: row.triggered_by_event_id,
        createdAt: row.created_at?.toISOString?.() ?? row.created_at,
        readAt: row.read_at?.toISOString?.() ?? row.read_at ?? undefined
      },
      subscription: {
        subscriptionId: row.subscription_id,
        userId: row.user_id,
        provider: row.provider,
        endpoint: row.endpoint,
        authSecret: row.auth_secret ?? undefined,
        p256dh: row.p256dh ?? undefined,
        deviceLabel: row.device_label ?? undefined,
        createdAt: row.subscription_created_at?.toISOString?.() ?? row.subscription_created_at,
        lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at,
        disabledAt: row.disabled_at?.toISOString?.() ?? row.disabled_at ?? undefined,
        failureCount: row.failure_count
      }
    }));
  }

  async upsertSupportFallback(fallback: SupportFallbackRecord) {
    await this.queryRunner.query(
      `
        insert into support_fallbacks (
          fallback_id, user_id, source_notification_id, channel, status, reason_code, reason_message,
          created_at, acknowledged_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9
        )
        on conflict (fallback_id) do update set
          user_id = excluded.user_id,
          source_notification_id = excluded.source_notification_id,
          channel = excluded.channel,
          status = excluded.status,
          reason_code = excluded.reason_code,
          reason_message = excluded.reason_message,
          created_at = excluded.created_at,
          acknowledged_at = excluded.acknowledged_at
      `,
      [
        fallback.fallbackId,
        fallback.userId,
        fallback.sourceNotificationId,
        fallback.channel,
        fallback.status,
        fallback.reasonCode,
        fallback.reasonMessage,
        fallback.createdAt,
        fallback.acknowledgedAt ?? null
      ]
    );
  }

  async listSupportFallbacksByUser(userId: string) {
    const result = await this.queryRunner.query(
      `
        select
          fallback_id, user_id, source_notification_id, channel, status, reason_code, reason_message,
          created_at, acknowledged_at
        from support_fallbacks
        where user_id = $1
        order by created_at desc
      `,
      [userId]
    );

    return result.rows.map((row) => ({
      fallbackId: row.fallback_id,
      userId: row.user_id,
      sourceNotificationId: row.source_notification_id,
      channel: row.channel,
      status: row.status,
      reasonCode: row.reason_code,
      reasonMessage: row.reason_message,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      acknowledgedAt: row.acknowledged_at?.toISOString?.() ?? row.acknowledged_at ?? undefined
    }));
  }

  async listSupportFallbacks(limit: number) {
    const result = await this.queryRunner.query(
      `
        select
          fallback_id, user_id, source_notification_id, channel, status, reason_code, reason_message,
          created_at, acknowledged_at
        from support_fallbacks
        order by created_at desc
        limit $1
      `,
      [limit]
    );

    return result.rows.map((row) => ({
      fallbackId: row.fallback_id,
      userId: row.user_id,
      sourceNotificationId: row.source_notification_id,
      channel: row.channel,
      status: row.status,
      reasonCode: row.reason_code,
      reasonMessage: row.reason_message,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      acknowledgedAt: row.acknowledged_at?.toISOString?.() ?? row.acknowledged_at ?? undefined
    }));
  }

  async acknowledgeSupportFallback(fallbackId: string, userId: string, acknowledgedAt: string) {
    await this.queryRunner.query(
      `
        update support_fallbacks
        set status = 'ACKNOWLEDGED',
            acknowledged_at = $3
        where fallback_id = $1
          and user_id = $2
      `,
      [fallbackId, userId, acknowledgedAt]
    );
  }

  async upsertWorkerHeartbeat(heartbeat: WorkerHeartbeatRecord) {
    await this.queryRunner.query(
      `
        insert into worker_heartbeats (
          worker_key, last_started_at, last_completed_at, last_status, last_summary
        ) values ($1, $2, $3, $4, $5)
        on conflict (worker_key) do update set
          last_started_at = excluded.last_started_at,
          last_completed_at = excluded.last_completed_at,
          last_status = excluded.last_status,
          last_summary = excluded.last_summary
      `,
      [
        heartbeat.workerKey,
        heartbeat.lastStartedAt,
        heartbeat.lastCompletedAt ?? null,
        heartbeat.lastStatus,
        heartbeat.lastSummary ?? null
      ]
    );
  }

  async listWorkerHeartbeats() {
    const result = await this.queryRunner.query(`
      select worker_key, last_started_at, last_completed_at, last_status, last_summary
      from worker_heartbeats
      order by worker_key asc
    `);

    return result.rows.map((row) => ({
      workerKey: row.worker_key,
      lastStartedAt: row.last_started_at?.toISOString?.() ?? row.last_started_at,
      lastCompletedAt: row.last_completed_at?.toISOString?.() ?? row.last_completed_at ?? undefined,
      lastStatus: row.last_status,
      lastSummary: row.last_summary ?? undefined
    }));
  }

  async enqueueOutboxEvent(event: Omit<OutboxEventRecord, "processedAt" | "resultPayload">) {
    await this.queryRunner.query(
      `
        insert into outbox_events (
          event_id, aggregate_type, aggregate_id, event_type, payload, available_at
        ) values ($1, $2, $3, $4, $5, $6)
        on conflict (event_id) do nothing
      `,
      [event.eventId, event.aggregateType, event.aggregateId, event.eventType, event.payload, event.availableAt]
    );
  }

  async claimOutboxEvents(limit: number, workerId: string, leaseSeconds: number) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `
          with claimable as (
            select event_id
            from outbox_events
            where processed_at is null
              and available_at <= now()
              and (claim_expires_at is null or claim_expires_at <= now())
            order by available_at asc
            limit $1
            for update skip locked
          )
          update outbox_events as events
          set claimed_at = now(),
              claimed_by = $2,
              claim_expires_at = now() + make_interval(secs => $3::int)
          from claimable
          where events.event_id = claimable.event_id
          returning
            events.event_id,
            events.aggregate_type,
            events.aggregate_id,
            events.event_type,
            events.payload,
            events.available_at,
            events.claimed_at,
            events.claimed_by,
            events.claim_expires_at,
            events.processed_at,
            events.result_payload
        `,
        [limit, workerId, leaseSeconds]
      );
      await client.query("commit");

      return result.rows.map((row) => ({
        eventId: row.event_id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: row.payload,
        availableAt: row.available_at?.toISOString?.() ?? row.available_at,
        claimedAt: row.claimed_at?.toISOString?.() ?? row.claimed_at ?? undefined,
        claimedBy: row.claimed_by ?? undefined,
        claimExpiresAt: row.claim_expires_at?.toISOString?.() ?? row.claim_expires_at ?? undefined,
        processedAt: row.processed_at?.toISOString?.() ?? row.processed_at ?? undefined,
        resultPayload: row.result_payload ?? undefined
      }));
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markOutboxEventProcessed(eventId: string, workerId: string, resultPayload?: Record<string, unknown>) {
    const result = await this.queryRunner.query(
      `
        update outbox_events
        set processed_at = now(),
            result_payload = $2,
            claimed_at = null,
            claimed_by = null,
            claim_expires_at = null
        where event_id = $1
          and claimed_by = $3
      `,
      [eventId, resultPayload ?? null, workerId]
    );

    if (result.rowCount === 0) {
      throw new Error(`OUTBOX_CLAIM_LOST:${eventId}`);
    }
  }

  async appendAuditLog(entry: AuditLogEntry) {
    await this.queryRunner.query(
      `
        insert into audit_logs (
          audit_id, actor_user_id, action, entity_type, entity_id, note, before_payload, after_payload, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (audit_id) do nothing
      `,
      [
        entry.auditId,
        entry.actorUserId,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.note ?? null,
        entry.before ?? null,
        entry.after ?? null,
        entry.createdAt
      ]
    );
  }

  async close() {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}
