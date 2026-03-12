import React from "react";

import type { AdminOpsDashboard, RuntimeReadinessSummary } from "../../../../packages/contracts/src/index.ts";
import { StatusBadge, butoTheme } from "../../../../packages/ui/src/index.ts";
import type { AdminDisputeDetail, AdminDisputeItem, ReleaseSubmissionDecision, SubmissionBundleDetail, SubmissionBundleRecommendation, SubmissionBundleSummary, WorkerHeartbeatItem } from "../api.ts";
import { TDSButton, TDSListRow } from "./lightweight-primitives.tsx";

export function AdminOperationsPanel(props: {
  adminDashboard: AdminOpsDashboard;
  adminDisputes: AdminDisputeItem[];
  adminDisputePage: number;
  adminDisputeTotal: number;
  adminDisputeHasNextPage: boolean;
  adminDisputeStatusFilter: "ALL" | "DISPUTED" | "CLIENT_CONFIRM_PENDING" | "DELIVERY_PROOF_SUBMITTED";
  adminDisputeRiskFilter: "ALL" | "LOW" | "MEDIUM" | "HIGH";
  adminDisputeQuery: string;
  adminDisputeSort: "job_id_desc" | "risk_desc" | "status_asc" | "title_asc";
  selectedAdminDisputeId: string | null;
  adminDisputeDetail: AdminDisputeDetail | null;
  runtimeWorkers: WorkerHeartbeatItem[];
  runtimeReadiness: RuntimeReadinessSummary | null;
  runtimeReadinessReportMarkdown: string | null;
  runtimeReadinessActionPlanMarkdown: string | null;
  runtimeReadinessEnvHandoffMarkdown: string | null;
  releaseStatusReportMarkdown: string | null;
  submissionBundles: SubmissionBundleSummary[];
  releaseSubmissionDecision: ReleaseSubmissionDecision | null;
  submissionBundleRecommendation: SubmissionBundleRecommendation | null;
  selectedSubmissionBundleLabel: string | null;
  selectedSubmissionBundleDetail: SubmissionBundleDetail | null;
  onResolveAdminDispute(jobId: string, resolution: "COMPLETED" | "CANCELLED" | "FAILED_SETTLEMENT"): void;
  onCopyOwnerEnvHandoff(owner: RuntimeReadinessSummary["owners"][number]["owner"]): Promise<string>;
  onSelectSubmissionBundle(bundleLabel: string): void;
  onSelectAdminDispute(jobId: string): void;
  onAdminDisputeStatusFilterChange(value: "ALL" | "DISPUTED" | "CLIENT_CONFIRM_PENDING" | "DELIVERY_PROOF_SUBMITTED"): void;
  onAdminDisputeRiskFilterChange(value: "ALL" | "LOW" | "MEDIUM" | "HIGH"): void;
  onAdminDisputeQueryChange(value: string): void;
  onAdminDisputeSortChange(value: "job_id_desc" | "risk_desc" | "status_asc" | "title_asc"): void;
  onAdminDisputePageChange(nextPage: number): void;
}) {
  const failedWorkers = props.runtimeWorkers.filter((worker) => worker.lastStatus === "FAILED");
  const [copiedDocument, setCopiedDocument] = React.useState<null | "report" | "action-plan" | "env-handoff" | "release-status" | `owner:${string}`>(null);
  const readinessOwnerActions = props.runtimeReadiness
    ? props.runtimeReadiness.owners.map((owner) => ({
        owner,
        checks: props.runtimeReadiness?.checks.filter((check) => check.owner === owner.owner && check.status !== "PASS") ?? []
      }))
    : [];

  async function handleCopyDocument(kind: "report" | "action-plan" | "env-handoff" | "release-status") {
    const markdown =
      kind === "report"
        ? props.runtimeReadinessReportMarkdown
        : kind === "action-plan"
          ? props.runtimeReadinessActionPlanMarkdown
          : kind === "env-handoff"
            ? props.runtimeReadinessEnvHandoffMarkdown
            : props.releaseStatusReportMarkdown;
    if (!markdown) {
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(markdown);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = markdown;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    setCopiedDocument(kind);
    window.setTimeout(() => {
      setCopiedDocument((current) => (current === kind ? null : current));
    }, 1800);
  }

  async function handleCopyOwnerEnvHandoff(owner: RuntimeReadinessSummary["owners"][number]["owner"]) {
    const markdown = await props.onCopyOwnerEnvHandoff(owner);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(markdown);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = markdown;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    const copiedKey = `owner:${owner}` as const;
    setCopiedDocument(copiedKey);
    window.setTimeout(() => {
      setCopiedDocument((current) => (current === copiedKey ? null : current));
    }, 1800);
  }

  return (
    <section style={panelStyle}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 24, color: butoTheme.colors.ink }}>운영 대시보드</h2>
        <p style={{ margin: "8px 0 0", color: "#57534e", lineHeight: 1.6 }}>
          검수, 분쟁, 긴급 이벤트, 푸시 상태를 한 번에 봅니다.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <MetricCard label="검수 큐" value={String(props.adminDashboard.queueCounts.reviewQueue)} tone="brand" />
        <MetricCard label="분쟁" value={String(props.adminDashboard.queueCounts.disputes)} tone="warning" />
        <MetricCard label="긴급 이벤트" value={String(props.adminDashboard.queueCounts.emergencies)} tone="warning" />
        <MetricCard label="차단 사용자" value={String(props.adminDashboard.queueCounts.blockedUsers)} tone="warning" />
        <MetricCard label="활성 푸시 구독" value={String(props.adminDashboard.push.subscriptions.active)} tone="brand" />
        <MetricCard label="푸시 실패" value={String(props.adminDashboard.push.deliveries.failed)} tone="warning" />
        <MetricCard label="상담 전환 OPEN" value={String(props.adminDashboard.supportFallbacks.open)} tone="warning" />
      </div>
      <ul style={{ ...listResetStyle, marginTop: 16 }}>
        {props.adminDashboard.recentAlerts.length === 0 ? <div style={cardStyle}>최근 운영 알림이 없어요.</div> : null}
        {props.adminDashboard.recentAlerts.slice(0, 5).map((alert) => (
          <TDSListRow
            key={`${alert.kind}:${alert.entityId}`}
            border="none"
            verticalPadding="large"
            horizontalPadding="small"
            style={cardStyle}
            contents={<TDSListRow.Texts type="2RowTypeA" top={alert.title} bottom={alert.kind} />}
            right={<span style={{ color: "#8b95a1", fontSize: 12 }}>{formatDateTime(alert.createdAt)}</span>}
          />
        ))}
      </ul>
      {failedWorkers.length > 0 ? (
        <div style={{ ...warningCardStyle, marginTop: 16 }}>
          <strong style={{ color: "#7f1d1d" }}>worker 실패 경고</strong>
          <p style={{ margin: "8px 0 0", color: "#7f1d1d", lineHeight: 1.6 }}>
            {failedWorkers.map((worker) => worker.workerKey).join(", ")} 가 마지막 실행에서 실패했어요. 재시도 전 heartbeat와 outbox 적체를 같이 확인해야 해요.
          </p>
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
        <strong style={{ color: butoTheme.colors.ink }}>출시 준비 상태</strong>
        {!props.runtimeReadiness ? <div style={cardStyle}>런타임 준비 상태를 불러오지 못했어요.</div> : null}
        {props.runtimeReadiness ? (
          <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
            {props.releaseSubmissionDecision ? (
              <div
                style={{
                  ...featureCardStyle,
                  background:
                    props.releaseSubmissionDecision.decision === "READY"
                      ? "#f0fdf4"
                      : props.releaseSubmissionDecision.decision === "CONDITIONAL"
                        ? "#fff7ed"
                        : "#fef2f2"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <strong style={{ color: butoTheme.colors.ink }}>최종 제출 판정</strong>
                  <StatusBadge
                    label={props.releaseSubmissionDecision.decision}
                    tone={props.releaseSubmissionDecision.decision === "READY" ? "brand" : "warning"}
                  />
                </div>
                <p style={{ margin: "8px 0 0", color: "#0f172a", lineHeight: 1.6 }}>
                  {props.releaseSubmissionDecision.summary}
                </p>
                {props.releaseSubmissionDecision.recommendedBundleLabel ? (
                  <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>
                    추천 번들: {props.releaseSubmissionDecision.recommendedBundleLabel}
                  </p>
                ) : null}
                <p style={{ margin: "8px 0 0", color: "#6b7280", lineHeight: 1.6 }}>
                  {props.releaseSubmissionDecision.reasons.join(" / ")}
                </p>
              </div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <strong style={{ color: butoTheme.colors.ink }}>
                  {props.runtimeReadiness.overallStatus === "READY"
                    ? "출시 가능"
                    : props.runtimeReadiness.overallStatus === "WARN"
                      ? "출시 전 점검 필요"
                      : "출시 차단 항목 있음"}
                </strong>
                <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>
                  BLOCK {props.runtimeReadiness.blockers}건 · WARN {props.runtimeReadiness.warnings}건
                </p>
              </div>
              <StatusBadge
                label={props.runtimeReadiness.overallStatus}
                tone={props.runtimeReadiness.overallStatus === "READY" ? "brand" : "warning"}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <TDSButton
                size="small"
                color="dark"
                variant="weak"
                disabled={!props.runtimeReadinessActionPlanMarkdown}
                onClick={() => {
                  void handleCopyDocument("action-plan");
                }}
              >
                {copiedDocument === "action-plan" ? "조치 계획 복사됨" : "조치 계획 복사"}
              </TDSButton>
              <TDSButton
                size="small"
                color="dark"
                variant="weak"
                disabled={!props.runtimeReadinessReportMarkdown}
                onClick={() => {
                  void handleCopyDocument("report");
                }}
              >
                {copiedDocument === "report" ? "리포트 복사됨" : "리포트 복사"}
              </TDSButton>
              <TDSButton
                size="small"
                color="dark"
                variant="weak"
                disabled={!props.runtimeReadinessEnvHandoffMarkdown}
                onClick={() => {
                  void handleCopyDocument("env-handoff");
                }}
              >
                {copiedDocument === "env-handoff" ? "env handoff 복사됨" : "env handoff 복사"}
              </TDSButton>
              <TDSButton
                size="small"
                color="dark"
                variant="weak"
                disabled={!props.releaseStatusReportMarkdown}
                onClick={() => {
                  void handleCopyDocument("release-status");
                }}
              >
                {copiedDocument === "release-status" ? "상태 스냅샷 복사됨" : "상태 스냅샷 복사"}
              </TDSButton>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              {props.runtimeReadiness.owners.map((owner) => (
                <div key={owner.owner} style={featureCardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <strong style={{ color: butoTheme.colors.ink }}>{formatReadinessOwner(owner.owner)}</strong>
                    <TDSButton
                      size="small"
                      color="dark"
                      variant="weak"
                      onClick={() => {
                        void handleCopyOwnerEnvHandoff(owner.owner);
                      }}
                    >
                      {copiedDocument === `owner:${owner.owner}` ? "owner env 복사됨" : "owner env 복사"}
                    </TDSButton>
                  </div>
                  <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>
                    BLOCK {owner.blockers} · WARN {owner.warnings} · PASS {owner.passing}
                  </p>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <strong style={{ color: butoTheme.colors.ink }}>owner별 남은 조치</strong>
              <div style={{ ...featureCardStyle, background: "#fffdf7" }}>
                <p style={{ margin: 0, color: "#4e5968", lineHeight: 1.6 }}>
                  실행 순서: 인프라 → 보안 → 제휴/사업 → 백엔드 → 리스크 운영
                </p>
              </div>
              {readinessOwnerActions.map(({ owner, checks }) => (
                <div key={`action:${owner.owner}`} style={featureCardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <strong style={{ color: butoTheme.colors.ink }}>{formatReadinessOwner(owner.owner)}</strong>
                    <span style={{ color: "#6b7280", fontSize: 12 }}>
                      BLOCK {owner.blockers} · WARN {owner.warnings}
                    </span>
                  </div>
                  {checks.length === 0 ? (
                    <p style={{ margin: "8px 0 0", color: "#047857", lineHeight: 1.6 }}>
                      열린 조치가 없어요.
                    </p>
                  ) : (
                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      {checks.map((check) => (
                        <div key={`owner-check:${check.key}`} style={nestedFeatureCardStyle}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                            <strong>{check.title}</strong>
                            <StatusBadge label={check.status} tone={check.status === "BLOCK" ? "warning" : "default"} />
                          </div>
                          <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>{check.detail}</p>
                          <p style={{ margin: "8px 0 0", color: "#0f172a", lineHeight: 1.6 }}>
                            다음 조치: {check.remediation}
                          </p>
                          {check.envKeys?.length ? (
                            <p style={{ margin: "8px 0 0", color: "#6b7280", lineHeight: 1.6 }}>
                              변수: {check.envKeys.join(", ")}
                            </p>
                          ) : null}
                          {check.references?.length ? (
                            <p style={{ margin: "8px 0 0", color: "#6b7280", lineHeight: 1.6 }}>
                              참고: {check.references.join(", ")}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <strong style={{ color: butoTheme.colors.ink }}>최근 제출 번들</strong>
              {props.submissionBundleRecommendation ? (
                <div style={{ ...featureCardStyle, background: "#f8fbff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <strong style={{ color: butoTheme.colors.ink }}>추천 제출 후보</strong>
                    <StatusBadge
                      label={props.submissionBundleRecommendation.status}
                      tone={props.submissionBundleRecommendation.status === "READY_TO_SUBMIT" ? "brand" : "warning"}
                    />
                  </div>
                  <p style={{ margin: "8px 0 0", color: "#0f172a", lineHeight: 1.6 }}>
                    {props.submissionBundleRecommendation.recommendedBundleLabel ?? "자동 추천 불가"}
                  </p>
                  <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>
                    {props.submissionBundleRecommendation.reasons.join(" / ")}
                  </p>
                </div>
              ) : null}
              {props.submissionBundles.length === 0 ? (
                <div style={featureCardStyle}>아직 생성된 제출 번들이 없어요.</div>
              ) : (
                props.submissionBundles.map((bundle) => (
                  <div
                    key={bundle.bundleLabel}
                    style={{
                      ...featureCardStyle,
                      borderColor: props.selectedSubmissionBundleLabel === bundle.bundleLabel ? "#2563eb" : featureCardStyle.borderColor
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <strong style={{ color: butoTheme.colors.ink }}>{bundle.bundleLabel}</strong>
                      <StatusBadge
                        label={bundle.overallStatus}
                        tone={bundle.overallStatus === "READY" ? "brand" : "warning"}
                      />
                    </div>
                    <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>
                      BLOCK {bundle.blockers} · WARN {bundle.warnings} · 문서 {bundle.documentCount}개 · env {bundle.envFileCount}개
                    </p>
                    <p style={{ margin: "8px 0 0", color: bundle.integrityStatus === "COMPLETE" ? "#047857" : "#b45309", lineHeight: 1.6 }}>
                      번들 무결성: {bundle.integrityStatus === "COMPLETE" ? "필수 파일 준비 완료" : `누락 ${bundle.missingFiles.join(", ")}`}
                    </p>
                    <p style={{ margin: "8px 0 0", color: bundle.driftStatus === "IN_SYNC" ? "#047857" : "#b45309", lineHeight: 1.6 }}>
                      현재성: {bundle.driftStatus === "IN_SYNC" ? "현재 readiness와 일치" : `현재 상태와 차이 있음 (${bundle.driftReasons.join(" / ")})`}
                    </p>
                    <p style={{ margin: "8px 0 0", color: "#6b7280", lineHeight: 1.6 }}>
                      생성 시각: {formatDateTime(bundle.generatedAt)}
                    </p>
                    <div style={{ marginTop: 10 }}>
                      <TDSButton
                        size="small"
                        color="dark"
                        variant="weak"
                        onClick={() => props.onSelectSubmissionBundle(bundle.bundleLabel)}
                      >
                        {props.selectedSubmissionBundleLabel === bundle.bundleLabel ? "선택됨" : "세부 보기"}
                      </TDSButton>
                    </div>
                  </div>
                ))
              )}
            </div>
            {props.selectedSubmissionBundleDetail ? (
              <div style={{ display: "grid", gap: 10 }}>
                <strong style={{ color: butoTheme.colors.ink }}>선택한 번들 상세</strong>
                <div style={featureCardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <strong style={{ color: butoTheme.colors.ink }}>{props.selectedSubmissionBundleDetail.bundleLabel}</strong>
                    <StatusBadge
                      label={props.selectedSubmissionBundleDetail.overallStatus}
                      tone={props.selectedSubmissionBundleDetail.overallStatus === "READY" ? "brand" : "warning"}
                    />
                  </div>
                  <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>
                    BLOCK {props.selectedSubmissionBundleDetail.blockers} · WARN {props.selectedSubmissionBundleDetail.warnings}
                  </p>
                  <p
                    style={{
                      margin: "8px 0 0",
                      color: props.selectedSubmissionBundleDetail.integrityStatus === "COMPLETE" ? "#047857" : "#b45309",
                      lineHeight: 1.6
                    }}
                  >
                    번들 무결성:{" "}
                    {props.selectedSubmissionBundleDetail.integrityStatus === "COMPLETE"
                      ? "필수 파일 준비 완료"
                      : `누락 ${props.selectedSubmissionBundleDetail.missingFiles.join(", ")}`}
                  </p>
                  <p
                    style={{
                      margin: "8px 0 0",
                      color: props.selectedSubmissionBundleDetail.driftStatus === "IN_SYNC" ? "#047857" : "#b45309",
                      lineHeight: 1.6
                    }}
                  >
                    현재성:{" "}
                    {props.selectedSubmissionBundleDetail.driftStatus === "IN_SYNC"
                      ? "현재 readiness와 일치"
                      : `현재 상태와 차이 있음 (${props.selectedSubmissionBundleDetail.driftReasons.join(" / ")})`}
                  </p>
                  <p style={{ margin: "8px 0 0", color: "#6b7280", lineHeight: 1.6 }}>
                    생성 시각: {formatDateTime(props.selectedSubmissionBundleDetail.generatedAt)}
                  </p>
                  <p style={{ margin: "8px 0 0", color: "#0f172a", lineHeight: 1.6 }}>
                    포함 문서: {props.selectedSubmissionBundleDetail.documents.map((document) => document.fileName).join(", ")}
                  </p>
                  {props.selectedSubmissionBundleDetail.envFiles.length ? (
                    <p style={{ margin: "8px 0 0", color: "#6b7280", lineHeight: 1.6 }}>
                      env 파일: {props.selectedSubmissionBundleDetail.envFiles.map((item) => item.fileName).join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {props.runtimeReadiness.checks.map((check) => (
              <div key={check.key} style={featureCardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <strong>{check.title}</strong>
                  <StatusBadge label={check.status} tone={check.status === "PASS" ? "brand" : "warning"} />
                </div>
                <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>{check.detail}</p>
                <p style={{ margin: "8px 0 0", color: "#0f172a", lineHeight: 1.6 }}>
                  담당: {formatReadinessOwner(check.owner)} · 조치: {check.remediation}
                </p>
                {check.references?.length ? (
                  <p style={{ margin: "8px 0 0", color: "#6b7280", lineHeight: 1.6 }}>
                    참고: {check.references.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
        <strong style={{ color: butoTheme.colors.ink }}>worker 상태</strong>
        {props.runtimeWorkers.length === 0 ? <div style={cardStyle}>기록된 worker heartbeat가 아직 없어요.</div> : null}
        {props.runtimeWorkers.map((worker) => (
          <TDSListRow
            key={worker.workerKey}
            border="none"
            verticalPadding="large"
            horizontalPadding="small"
            style={cardStyle}
            contents={
              <TDSListRow.Texts
                type="2RowTypeA"
                top={worker.workerKey}
                bottom={`상태 ${worker.lastStatus} · 시작 ${formatDateTime(worker.lastStartedAt)}${worker.lastCompletedAt ? ` · 완료 ${formatDateTime(worker.lastCompletedAt)}` : ""}`}
              />
            }
            right={<StatusBadge label={worker.lastStatus} tone={worker.lastStatus === "FAILED" ? "warning" : worker.lastStatus === "RUNNING" ? "brand" : "default"} />}
          />
        ))}
      </div>
      <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
        <strong style={{ color: butoTheme.colors.ink }}>분쟁 처리</strong>
        <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#6b7280", fontSize: 13 }}>상태</span>
              <select
                value={props.adminDisputeStatusFilter}
                onChange={(event) => props.onAdminDisputeStatusFilterChange(event.target.value as "ALL" | "DISPUTED" | "CLIENT_CONFIRM_PENDING" | "DELIVERY_PROOF_SUBMITTED")}
                style={inputStyle}
              >
                <option value="ALL">전체</option>
                <option value="DISPUTED">DISPUTED</option>
                <option value="CLIENT_CONFIRM_PENDING">CLIENT_CONFIRM_PENDING</option>
                <option value="DELIVERY_PROOF_SUBMITTED">DELIVERY_PROOF_SUBMITTED</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#6b7280", fontSize: 13 }}>위험도</span>
              <select
                value={props.adminDisputeRiskFilter}
                onChange={(event) => props.onAdminDisputeRiskFilterChange(event.target.value as "ALL" | "LOW" | "MEDIUM" | "HIGH")}
                style={inputStyle}
              >
                <option value="ALL">전체</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#6b7280", fontSize: 13 }}>검색</span>
              <input
                value={props.adminDisputeQuery}
                onChange={(event) => props.onAdminDisputeQueryChange(event.target.value)}
                placeholder="job id 또는 제목"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#6b7280", fontSize: 13 }}>정렬</span>
              <select
                value={props.adminDisputeSort}
                onChange={(event) => props.onAdminDisputeSortChange(event.target.value as "job_id_desc" | "risk_desc" | "status_asc" | "title_asc")}
                style={inputStyle}
              >
                <option value="job_id_desc">최근 등록순</option>
                <option value="risk_desc">위험도 우선</option>
                <option value="status_asc">상태순</option>
                <option value="title_asc">제목순</option>
              </select>
            </label>
          </div>
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            총 {props.adminDisputeTotal}건 · 페이지 {props.adminDisputePage}
          </div>
        </div>
        {props.adminDisputes.length === 0 ? <div style={cardStyle}>열린 분쟁이 없어요.</div> : null}
        {props.adminDisputes.map((job) => (
          <div key={job.jobId} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <strong style={{ color: butoTheme.colors.ink }}>{job.title}</strong>
                <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>
                  상태 {job.status} · 신고 {job.hasReport ? "있음" : "없음"} · 분쟁 {job.hasDispute ? "열림" : "없음"}
                </p>
              </div>
              <StatusBadge label={job.riskLevel} tone={job.riskLevel === "LOW" ? "brand" : "warning"} />
            </div>
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              <TDSButton
                size="small"
                color="dark"
                variant={props.selectedAdminDisputeId === job.jobId ? "fill" : "weak"}
                onClick={() => props.onSelectAdminDispute(job.jobId)}
              >
                {props.selectedAdminDisputeId === job.jobId ? "증거 숨기기" : "증거 보기"}
              </TDSButton>
              <TDSButton size="small" color="primary" variant="fill" onClick={() => props.onResolveAdminDispute(job.jobId, "COMPLETED")}>
                완료 처리
              </TDSButton>
              <TDSButton size="small" color="dark" variant="weak" onClick={() => props.onResolveAdminDispute(job.jobId, "CANCELLED")}>
                취소 처리
              </TDSButton>
              <TDSButton size="small" color="dark" variant="weak" onClick={() => props.onResolveAdminDispute(job.jobId, "FAILED_SETTLEMENT")}>
                정산 실패 처리
              </TDSButton>
            </div>
          </div>
        ))}
        {props.adminDisputeDetail ? (
          <div style={{ ...cardStyle, display: "grid", gap: 14, marginTop: 4 }}>
            <div>
              <strong style={{ color: butoTheme.colors.ink }}>분쟁 상세 증거</strong>
              <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>
                자동 판정이 아니라 최근 증거를 묶어 보는 화면이에요. 픽업 이후 건은 운영 검토와 증거 보존이 우선입니다.
              </p>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <Field label="의뢰" value={props.adminDisputeDetail.job.title} />
              <Field label="구간" value={`${props.adminDisputeDetail.job.pickupAddress} → ${props.adminDisputeDetail.job.dropoffAddress}`} />
              <Field label="금액" value={`${props.adminDisputeDetail.job.offerAmount.toLocaleString("ko-KR")}원`} />
              <Field label="상태" value={`${props.adminDisputeDetail.job.status} / ${props.adminDisputeDetail.job.riskLevel}`} />
            </div>
            {props.adminDisputeDetail.payment ? (
              <div style={featureCardStyle}>
                <strong>결제 상태</strong>
                <p style={featureBodyStyle}>
                  {props.adminDisputeDetail.payment.status} · 보관금 {props.adminDisputeDetail.payment.heldAmount.toLocaleString("ko-KR")}원 · 수수료 {props.adminDisputeDetail.payment.feeAmount.toLocaleString("ko-KR")}원
                </p>
                <p style={{ margin: "8px 0 0", color: "#6b7280", lineHeight: 1.6 }}>
                  {props.adminDisputeDetail.payment.providerPaymentMethod ?? "결제수단 미기록"}
                  {props.adminDisputeDetail.payment.transactionId ? ` · ${props.adminDisputeDetail.payment.transactionId}` : ""}
                </p>
              </div>
            ) : null}
            <div style={{ display: "grid", gap: 10 }}>
              <strong style={{ color: butoTheme.colors.ink }}>최근 채팅</strong>
              {props.adminDisputeDetail.chatMessages.length === 0 ? <div style={featureCardStyle}>채팅 기록이 없어요.</div> : null}
              {props.adminDisputeDetail.chatMessages.map((message) => (
                <div key={message.messageId} style={featureCardStyle}>
                  <strong>{message.senderNickname}</strong>
                  <p style={featureBodyStyle}>{message.body}</p>
                  <p style={{ margin: "8px 0 0", color: "#6b7280", lineHeight: 1.5 }}>
                    {message.messageType} · {message.moderationStatus} · {formatDateTime(message.createdAt)}
                  </p>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <strong style={{ color: butoTheme.colors.ink }}>최근 위치 기록</strong>
              {props.adminDisputeDetail.locationLogs.length === 0 ? <div style={featureCardStyle}>위치 기록이 없어요.</div> : null}
              {props.adminDisputeDetail.locationLogs.map((log) => (
                <div key={`${log.userId}:${log.loggedAt}`} style={featureCardStyle}>
                  <strong>{log.role}</strong>
                  <p style={featureBodyStyle}>
                    {log.lat.toFixed(5)}, {log.lng.toFixed(5)} · 정확도 {Math.round(log.accuracy)}m · {log.source}
                  </p>
                  <p style={{ margin: "8px 0 0", color: "#6b7280" }}>{formatDateTime(log.loggedAt)}</p>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <strong style={{ color: butoTheme.colors.ink }}>증빙 사진</strong>
              {props.adminDisputeDetail.proofPhotos.length === 0 ? <div style={featureCardStyle}>등록된 증빙이 없어요.</div> : null}
              {props.adminDisputeDetail.proofPhotos.map((photo) => (
                <div key={photo.proofId} style={featureCardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <strong>{photo.proofType === "pickup" ? "픽업 증빙" : "전달 증빙"}</strong>
                    <span style={{ color: "#6b7280", fontSize: 12 }}>{formatDateTime(photo.createdAt)}</span>
                  </div>
                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    <img
                      src={photo.watermarkedUrl}
                      alt={`${photo.proofType} 증빙`}
                      style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 14, border: "1px solid #e5e8eb" }}
                    />
                    <span style={{ color: "#6b7280", fontSize: 12 }}>업로더 {photo.uploadedBy}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <strong style={{ color: butoTheme.colors.ink }}>신고 / 긴급 이벤트</strong>
              {props.adminDisputeDetail.reports.length === 0 && props.adminDisputeDetail.emergencies.length === 0 ? (
                <div style={featureCardStyle}>연결된 신고와 긴급 이벤트가 없어요.</div>
              ) : null}
              {props.adminDisputeDetail.reports.map((report) => (
                <div key={report.reportId} style={featureCardStyle}>
                  <strong>신고 {report.reportType}</strong>
                  <p style={featureBodyStyle}>{report.detail ?? "상세 내용 없음"}</p>
                  <p style={{ margin: "8px 0 0", color: "#6b7280" }}>
                    신고자 {report.reporterUserId} · 대상 {report.targetUserId} · {formatDateTime(report.createdAt)}
                  </p>
                </div>
              ))}
              {props.adminDisputeDetail.emergencies.map((event) => (
                <div key={event.emergencyEventId} style={featureCardStyle}>
                  <strong>긴급 {event.eventType}</strong>
                  <p style={featureBodyStyle}>
                    좌표 {event.lat.toFixed(5)}, {event.lng.toFixed(5)}
                  </p>
                  <p style={{ margin: "8px 0 0", color: "#6b7280" }}>{formatDateTime(event.createdAt)}</p>
                </div>
              ))}
            </div>
            {props.adminDisputeDetail.latestCancellationRequest ? (
              <div style={featureCardStyle}>
                <strong>최근 취소 요청</strong>
                <p style={featureBodyStyle}>
                  {props.adminDisputeDetail.latestCancellationRequest.status} · {props.adminDisputeDetail.latestCancellationRequest.reason}
                </p>
                <p style={{ margin: "8px 0 0", color: "#6b7280" }}>
                  {formatDateTime(props.adminDisputeDetail.latestCancellationRequest.requestedAt)}
                </p>
              </div>
            ) : null}
          </div>
        ) : props.selectedAdminDisputeId ? (
          <div style={cardStyle}>분쟁 상세를 불러오는 중이거나 더 이상 열린 분쟁이 아니에요.</div>
        ) : null}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <TDSButton
            size="small"
            color="dark"
            variant="weak"
            disabled={props.adminDisputePage <= 1}
            onClick={() => props.onAdminDisputePageChange(props.adminDisputePage - 1)}
          >
            이전
          </TDSButton>
          <TDSButton
            size="small"
            color="dark"
            variant="weak"
            disabled={!props.adminDisputeHasNextPage}
            onClick={() => props.onAdminDisputePageChange(props.adminDisputePage + 1)}
          >
            다음
          </TDSButton>
        </div>
      </div>
    </section>
  );
}

function MetricCard(props: { label: string; value: string; tone: "brand" | "warning" | "default" }) {
  return (
    <div
      style={{
        ...cardStyle,
        borderColor: props.tone === "warning" ? "#fdba74" : props.tone === "brand" ? "#bfdbfe" : "#e5e8eb",
        background: props.tone === "warning" ? "#fff7ed" : props.tone === "brand" ? "#f8fbff" : "#ffffff"
      }}
    >
      <div style={{ color: "#78716c", fontSize: 13 }}>{props.label}</div>
      <div style={{ marginTop: 10, fontSize: 28, fontWeight: 800, color: "#1c1917" }}>{props.value}</div>
    </div>
  );
}

function Field(props: { label: string; value: string }) {
  return (
    <label style={{ display: "grid", gap: 8 }}>
      <span style={{ fontWeight: 700, color: butoTheme.colors.ink }}>{props.label}</span>
      <div style={cardStyle}>{props.value}</div>
    </label>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatReadinessOwner(owner: RuntimeReadinessSummary["checks"][number]["owner"]) {
  if (owner === "BACKEND") {
    return "백엔드";
  }
  if (owner === "INFRA") {
    return "인프라";
  }
  if (owner === "SECURITY") {
    return "보안";
  }
  if (owner === "RISK_OPS") {
    return "리스크 운영";
  }

  return "제휴/사업";
}

const panelStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 28,
  padding: 24,
  border: `1px solid ${butoTheme.colors.line}`,
  boxShadow: butoTheme.shadow
};

const cardStyle: React.CSSProperties = {
  background: "#fbfcfe",
  borderRadius: 24,
  padding: 16,
  border: `1px solid ${butoTheme.colors.line}`
};

const listResetStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: 12
};

const warningCardStyle: React.CSSProperties = {
  ...cardStyle,
  borderColor: "#fecaca",
  background: "#fff8f2"
};

const featureCardStyle: React.CSSProperties = {
  ...cardStyle,
  background: "#f9fbff"
};

const nestedFeatureCardStyle: React.CSSProperties = {
  ...cardStyle,
  background: "#ffffff",
  borderRadius: 18,
  padding: 14
};

const featureBodyStyle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "#4e5968",
  lineHeight: 1.7
};

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 16,
  border: `1px solid ${butoTheme.colors.line}`,
  font: "inherit",
  background: "#ffffff",
  color: butoTheme.colors.ink
};
