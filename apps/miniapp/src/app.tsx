import React, { Suspense, lazy, startTransition, useEffect, useRef, useState } from "react";

import { productConfig } from "../../../packages/config/src/index.ts";
import type { AdminOpsDashboard, AppealStatus, EnforcementReviewStatus, EnforcementStatusSummary, JobCard, NotificationRecord, RuntimeReadinessSummary, SafetyRuleDocument, SupportFallbackRecord } from "../../../packages/contracts/src/index.ts";
import { SafetyCard, StatusBadge, butoTheme } from "../../../packages/ui/src/index.ts";

import {
  acknowledgeSafety,
  acknowledgeSupportFallback,
  completeProofPhoto,
  confirmJobPayment,
  ApiClientError,
  completeSensitiveFaceAuth,
  completeTossLogin,
  createJobReport,
  createJobRequest,
  createProofUploadSession,
  createAppeal,
  connectNotificationStream,
  fetchAdminDisputeDetail,
  fetchAdminDisputes,
  fetchAdminSubmissionBundleDetail,
  fetchAdminSubmissionBundleRecommendation,
  fetchActiveJobs,
  fetchAdminSubmissionBundles,
  fetchNearbyJobs,
  fetchAdminOpsDashboard,
  fetchRuntimeReadiness,
  fetchRuntimeReadinessActionPlan,
  fetchRuntimeReadinessEnvHandoff,
  fetchRuntimeReadinessEnvHandoffByOwner,
  fetchRuntimeReadinessReport,
  fetchReleaseSubmissionDecision,
  fetchReleaseStatusReport,
  fetchAppealDetail,
  fetchEnforcementActions,
  fetchEnforcementStatus,
  fetchNotifications,
  fetchRuntimeWorkers,
  fetchSupportFallbacks,
  fetchSafetyRules,
  initJobPayment,
  logJobLocation,
  logoutSession,
  markNotificationRead,
  reconcileJobPayment,
  resolveAdminDispute,
  updateJobStatus,
  requestJobCancellation,
  respondJobCancellation,
  startSensitiveFaceAuth,
  startTossLogin,
  uploadProofPhotoToSignedUrl,
  type ActiveJobItem,
  type AdminDisputeDetail,
  type AdminDisputeItem,
  type AppealDetail,
  type EnforcementActionWithEvidence,
  type LoginSession,
  type SubmissionBundleDetail,
  type ReleaseSubmissionDecision,
  type SubmissionBundleRecommendation,
  type SubmissionBundleSummary,
  type WorkerHeartbeatItem,
  withdrawMembership
} from "./api.ts";
import {
  captureCameraImage,
  checkoutTossPayment,
  detectTossSdkAvailability,
  fetchRecentAlbumPhotos,
  getCameraPermission,
  getLocationPermission,
  getPhotosPermission,
  openExternalUrl,
  openCameraPermissionDialog,
  openLocationPermissionDialog,
  openPhotosPermissionDialog,
  openTossOneTouch,
  readCurrentLocation,
  startAppsInTossLogin,
  startLocationUpdates,
  type TossSdkAvailability
} from "./toss-sdk.ts";
import { TDSButton, TDSListRow, TDSTab, TDSTextButton } from "./components/lightweight-primitives.tsx";

type TabKey = "home" | "request" | "nearby" | "active" | "reviews" | "profile";
type BusyAction = "login" | "safety" | "toss-auth" | "logout" | "withdraw" | "appeal" | null;

interface RestrictionState {
  status: "RESTRICTED" | "SUSPENDED" | "APPEAL_PENDING" | "PERMANENTLY_BANNED" | "WITHDRAWN";
  title: string;
  body: string;
  reasonCode?: string;
  scope?: string;
  reviewStatus?: AppealStatus | EnforcementReviewStatus;
  actionId?: string;
  supportUrl?: string;
}

interface SessionState extends LoginSession {
  tossAuthValidUntil?: string;
}

const defaultSdkState: TossSdkAvailability = {
  available: false,
  supportsOneTouch: false
};

const supportKakaoChannelUrl = import.meta.env.VITE_BUTO_SUPPORT_KAKAOTALK_URL;
const emergencyCallUrl = import.meta.env.VITE_BUTO_EMERGENCY_CALL_URL ?? "tel:0000000000";
const emergencySmsUrl = import.meta.env.VITE_BUTO_EMERGENCY_SMS_URL ?? "sms:0000000000?body=BUTO%20emergency%20placeholder";
const AdminOperationsPanel = lazy(() =>
  import("./components/admin-operations-panel.tsx").then((module) => ({
    default: module.AdminOperationsPanel
  }))
);
const ReviewsCommunityScreen = lazy(() =>
  import("./components/static-screens.tsx").then((module) => ({
    default: module.ReviewsCommunityScreen
  }))
);
const ProfileScreen = lazy(() =>
  import("./components/static-screens.tsx").then((module) => ({
    default: module.ProfileScreen
  }))
);

export function MiniApp() {
  const [tab, setTab] = useState<TabKey>("home");
  const [session, setSession] = useState<SessionState | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [restrictionState, setRestrictionState] = useState<RestrictionState | null>(null);
  const [sdkState, setSdkState] = useState<TossSdkAvailability>(defaultSdkState);
  const [safetyRules, setSafetyRules] = useState<SafetyRuleDocument | null>(null);
  const [nearbyJobs, setNearbyJobs] = useState<JobCard[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [enforcementStatus, setEnforcementStatus] = useState<EnforcementStatusSummary | null>(null);
  const [enforcementActions, setEnforcementActions] = useState<EnforcementActionWithEvidence[]>([]);
  const [appealDraft, setAppealDraft] = useState("");
  const [appealDetail, setAppealDetail] = useState<AppealDetail | null>(null);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [supportFallbacks, setSupportFallbacks] = useState<SupportFallbackRecord[]>([]);
  const [adminDashboard, setAdminDashboard] = useState<AdminOpsDashboard | null>(null);
  const [adminDisputes, setAdminDisputes] = useState<AdminDisputeItem[]>([]);
  const [adminDisputePage, setAdminDisputePage] = useState(1);
  const [adminDisputeTotal, setAdminDisputeTotal] = useState(0);
  const [adminDisputeHasNextPage, setAdminDisputeHasNextPage] = useState(false);
  const [adminDisputeStatusFilter, setAdminDisputeStatusFilter] = useState<"ALL" | "DISPUTED" | "CLIENT_CONFIRM_PENDING" | "DELIVERY_PROOF_SUBMITTED">("ALL");
  const [adminDisputeRiskFilter, setAdminDisputeRiskFilter] = useState<"ALL" | "LOW" | "MEDIUM" | "HIGH">("ALL");
  const [adminDisputeQuery, setAdminDisputeQuery] = useState("");
  const [debouncedAdminDisputeQuery, setDebouncedAdminDisputeQuery] = useState("");
  const [adminDisputeSort, setAdminDisputeSort] = useState<"job_id_desc" | "risk_desc" | "status_asc" | "title_asc">("job_id_desc");
  const [selectedAdminDisputeId, setSelectedAdminDisputeId] = useState<string | null>(null);
  const [adminDisputeDetail, setAdminDisputeDetail] = useState<AdminDisputeDetail | null>(null);
  const [runtimeWorkers, setRuntimeWorkers] = useState<WorkerHeartbeatItem[]>([]);
  const [runtimeReadiness, setRuntimeReadiness] = useState<RuntimeReadinessSummary | null>(null);
  const [runtimeReadinessReportMarkdown, setRuntimeReadinessReportMarkdown] = useState<string | null>(null);
  const [runtimeReadinessActionPlanMarkdown, setRuntimeReadinessActionPlanMarkdown] = useState<string | null>(null);
  const [runtimeReadinessEnvHandoffMarkdown, setRuntimeReadinessEnvHandoffMarkdown] = useState<string | null>(null);
  const [releaseStatusReportMarkdown, setReleaseStatusReportMarkdown] = useState<string | null>(null);
  const [submissionBundles, setSubmissionBundles] = useState<SubmissionBundleSummary[]>([]);
  const [selectedSubmissionBundleLabel, setSelectedSubmissionBundleLabel] = useState<string | null>(null);
  const [selectedSubmissionBundleDetail, setSelectedSubmissionBundleDetail] = useState<SubmissionBundleDetail | null>(null);
  const [submissionBundleRecommendation, setSubmissionBundleRecommendation] = useState<SubmissionBundleRecommendation | null>(null);
  const [releaseSubmissionDecision, setReleaseSubmissionDecision] = useState<ReleaseSubmissionDecision | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      startTransition(() => {
        setDebouncedAdminDisputeQuery(adminDisputeQuery);
      });
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [adminDisputeQuery]);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const [rules, sdk] = await Promise.all([fetchSafetyRules(), detectTossSdkAvailability()]);
        if (disposed) {
          return;
        }

        startTransition(() => {
          setSafetyRules(rules);
          setSdkState(sdk);
        });
      } catch (error) {
        if (disposed) {
          return;
        }

        handleRuntimeError(error);
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!session?.accessToken || tab !== "nearby") {
      return;
    }

    let disposed = false;
    setJobsLoading(true);

    void (async () => {
      try {
        const response = await fetchNearbyJobs(session.accessToken);
        if (disposed) {
          return;
        }

        startTransition(() => {
          setNearbyJobs(response.items);
        });
      } catch (error) {
        if (!disposed) {
          handleRuntimeError(error);
        }
      } finally {
        if (!disposed) {
          setJobsLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [session?.accessToken, tab]);

  useEffect(() => {
    if (!session || isOperationalUserStatus(session.user.status)) {
      startTransition(() => {
        setEnforcementStatus(null);
        setEnforcementActions([]);
        setAppealDetail(null);
      });
      return;
    }

    let disposed = false;
    void (async () => {
      try {
        const [status, actions] = await Promise.all([
          fetchEnforcementStatus(session.accessToken),
          fetchEnforcementActions(session.accessToken)
        ]);

        if (disposed) {
          return;
        }

        startTransition(() => {
          setEnforcementStatus(status);
          setEnforcementActions(actions.items);
        });
      } catch (error) {
        if (!disposed) {
          handleRuntimeError(error);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session?.accessToken || !enforcementStatus?.latestAppeal?.appealId) {
      return;
    }

    let disposed = false;
    void (async () => {
      try {
        const detail = await fetchAppealDetail({
          accessToken: session.accessToken,
          appealId: enforcementStatus.latestAppeal!.appealId
        });

        if (disposed) {
          return;
        }

        startTransition(() => {
          setAppealDetail(detail);
        });
      } catch (error) {
        if (!disposed) {
          handleRuntimeError(error);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [enforcementStatus?.latestAppeal?.appealId, session?.accessToken]);

  useEffect(() => {
    if (!session?.accessToken) {
      startTransition(() => {
        setNotifications([]);
        setSupportFallbacks([]);
        setAdminDashboard(null);
        setAdminDisputes([]);
        setAdminDisputePage(1);
        setAdminDisputeTotal(0);
        setAdminDisputeHasNextPage(false);
        setDebouncedAdminDisputeQuery("");
        setSelectedAdminDisputeId(null);
        setAdminDisputeDetail(null);
        setRuntimeWorkers([]);
        setRuntimeReadiness(null);
      });
      return;
    }

    let disposed = false;
    void (async () => {
      try {
        const [notificationResponse, supportResponse] = await Promise.all([
          fetchNotifications(session.accessToken),
          fetchSupportFallbacks(session.accessToken)
        ]);
        if (disposed) {
          return;
        }

        startTransition(() => {
          setNotifications(notificationResponse.items);
          setSupportFallbacks(supportResponse.items);
        });
      } catch (error) {
        if (!disposed) {
          handleRuntimeError(error);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [session?.accessToken, enforcementStatus?.latestAppeal?.appealId, tab]);

  useEffect(() => {
    if (!session?.accessToken || !session.user.roleFlags.includes("ADMIN")) {
      startTransition(() => {
        setAdminDashboard(null);
        setAdminDisputes([]);
        setAdminDisputePage(1);
        setAdminDisputeTotal(0);
        setAdminDisputeHasNextPage(false);
        setDebouncedAdminDisputeQuery("");
        setSelectedAdminDisputeId(null);
        setAdminDisputeDetail(null);
        setRuntimeWorkers([]);
        setRuntimeReadiness(null);
        setRuntimeReadinessReportMarkdown(null);
        setRuntimeReadinessActionPlanMarkdown(null);
        setRuntimeReadinessEnvHandoffMarkdown(null);
        setReleaseStatusReportMarkdown(null);
        setSubmissionBundles([]);
        setSelectedSubmissionBundleLabel(null);
        setSelectedSubmissionBundleDetail(null);
        setSubmissionBundleRecommendation(null);
        setReleaseSubmissionDecision(null);
      });
      return;
    }

    let disposed = false;
    void (async () => {
      try {
        const [dashboard, disputes, workers, readiness, readinessReport, readinessActionPlan, readinessEnvHandoff, releaseStatusReport, recentBundles, bundleRecommendation, releaseDecision] = await Promise.all([
          fetchAdminOpsDashboard(session.accessToken),
          fetchAdminDisputes({
            accessToken: session.accessToken,
            status: adminDisputeStatusFilter,
            riskLevel: adminDisputeRiskFilter,
            query: debouncedAdminDisputeQuery,
            sort: adminDisputeSort,
            page: adminDisputePage,
            pageSize: 5
          }),
          fetchRuntimeWorkers(session.accessToken),
          fetchRuntimeReadiness(session.accessToken),
          fetchRuntimeReadinessReport(session.accessToken),
          fetchRuntimeReadinessActionPlan(session.accessToken),
          fetchRuntimeReadinessEnvHandoff(session.accessToken),
          fetchReleaseStatusReport(session.accessToken),
          fetchAdminSubmissionBundles({
            accessToken: session.accessToken,
            limit: 5
          }),
          fetchAdminSubmissionBundleRecommendation(session.accessToken),
          fetchReleaseSubmissionDecision(session.accessToken)
        ]);
        if (disposed) {
          return;
        }

        startTransition(() => {
          setAdminDashboard(dashboard);
          setAdminDisputes(disputes.items);
          setAdminDisputeTotal(disputes.total);
          setAdminDisputeHasNextPage(disputes.hasNextPage);
          if (!disputes.items.some((item) => item.jobId === selectedAdminDisputeId)) {
            setSelectedAdminDisputeId(null);
            setAdminDisputeDetail(null);
          }
          setRuntimeWorkers(workers.items);
          setRuntimeReadiness(readiness);
          setRuntimeReadinessReportMarkdown(readinessReport.markdown);
          setRuntimeReadinessActionPlanMarkdown(readinessActionPlan.markdown);
          setRuntimeReadinessEnvHandoffMarkdown(readinessEnvHandoff.markdown);
          setReleaseStatusReportMarkdown(releaseStatusReport.markdown);
          setSubmissionBundles(recentBundles.items);
          setSubmissionBundleRecommendation(bundleRecommendation);
          setReleaseSubmissionDecision(releaseDecision);
          if (!recentBundles.items.some((item) => item.bundleLabel === selectedSubmissionBundleLabel)) {
            setSelectedSubmissionBundleLabel(recentBundles.items[0]?.bundleLabel ?? null);
            setSelectedSubmissionBundleDetail(null);
          }
        });
      } catch (error) {
        if (!disposed) {
          handleRuntimeError(error);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [
    adminDisputePage,
    adminDisputeSort,
    adminDisputeRiskFilter,
    adminDisputeStatusFilter,
    debouncedAdminDisputeQuery,
    notifications.length,
    selectedAdminDisputeId,
    session?.accessToken,
    session?.user.roleFlags,
    supportFallbacks.length
  ]);

  useEffect(() => {
    if (!session?.accessToken || !session.user.roleFlags.includes("ADMIN") || !selectedSubmissionBundleLabel) {
      startTransition(() => {
        setSelectedSubmissionBundleDetail(null);
      });
      return;
    }

    let disposed = false;
    void (async () => {
      try {
        const detail = await fetchAdminSubmissionBundleDetail({
          accessToken: session.accessToken,
          bundleLabel: selectedSubmissionBundleLabel
        });
        if (disposed) {
          return;
        }

        startTransition(() => {
          setSelectedSubmissionBundleDetail(detail);
        });
      } catch (error) {
        if (!disposed) {
          handleRuntimeError(error);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [selectedSubmissionBundleLabel, session?.accessToken, session?.user.roleFlags]);

  useEffect(() => {
    if (!session?.accessToken || !session.user.roleFlags.includes("ADMIN") || !selectedAdminDisputeId) {
      startTransition(() => {
        setAdminDisputeDetail(null);
      });
      return;
    }

    let disposed = false;
    void (async () => {
      try {
        const detail = await fetchAdminDisputeDetail({
          accessToken: session.accessToken,
          jobId: selectedAdminDisputeId
        });
        if (disposed) {
          return;
        }

        startTransition(() => {
          setAdminDisputeDetail(detail);
        });
      } catch (error) {
        if (!disposed) {
          handleRuntimeError(error);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [selectedAdminDisputeId, session?.accessToken, session?.user.roleFlags]);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    const controller = new AbortController();
    let reconnectTimer: number | undefined;

    const connect = async () => {
      try {
        await connectNotificationStream({
          accessToken: session.accessToken,
          signal: controller.signal,
          onNotifications(items) {
            startTransition(() => {
              setNotifications(items);
            });
          },
          onError(error) {
            handleRuntimeError(error);
          }
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, 3_000);
      }
    };

    void connect();

    return () => {
      controller.abort();
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [session?.accessToken]);

  async function handleLogin() {
    setBusyAction("login");
    setErrorMessage(null);

    try {
      const loginState = await startTossLogin();
      const tossLogin = await startAppsInTossLogin();
      const loginSession = await completeTossLogin({
        authorizationCode: tossLogin.authorizationCode,
        state: loginState.state
      });

      startTransition(() => {
        setRestrictionState(null);
        setEnforcementStatus(null);
        setEnforcementActions([]);
        setAppealDetail(null);
        setAppealDraft("");
        setSession(loginSession);
        setTab("home");
      });
    } catch (error) {
      handleRuntimeError(error);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSafetyAcknowledge() {
    if (!session || !safetyRules) {
      return;
    }

    setBusyAction("safety");
    setErrorMessage(null);

    try {
      await acknowledgeSafety({
        accessToken: session.accessToken,
        rulesVersion: safetyRules.rulesVersion
      });

      startTransition(() => {
        setSession({
          ...session,
          needsSafetyAcknowledgement: false
        });
      });
    } catch (error) {
      handleRuntimeError(error);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStartTossAuth() {
    if (!session) {
      setErrorMessage("먼저 로그인해 주세요.");
      return;
    }

    if (!sdkState.available) {
      setErrorMessage("Apps-in-Toss SDK를 불러오지 못했어요. 패키지 설치와 WebView 환경을 확인해 주세요.");
      return;
    }

    if (!sdkState.supportsOneTouch) {
      setErrorMessage(`토스 앱 ${sdkState.appVersion ?? "구버전"}에서는 원터치 인증을 지원하지 않아요. 5.236.0 이상으로 업데이트해 주세요.`);
      return;
    }

    setBusyAction("toss-auth");
    setErrorMessage(null);

    try {
      const started = await startSensitiveFaceAuth({
        accessToken: session.accessToken,
        intent: "JOB_CREATE"
      });

      if (!started.txId) {
        throw new Error("토스 인증 txId가 응답에 포함되지 않았어요.");
      }

      await openTossOneTouch(started.txId);

      const completed = await completeSensitiveFaceAuth({
        accessToken: session.accessToken,
        faceAuthSessionId: started.faceAuthSessionId
      });

      if (!completed.verified) {
        throw new Error(`토스 원터치 인증이 완료되지 않았어요. 상태: ${completed.riskCode}`);
      }

      startTransition(() => {
        setSession({
          ...session,
          tossAuthValidUntil: completed.validUntil
        });
      });
    } catch (error) {
      handleRuntimeError(error);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleLogout() {
    if (!session) {
      return;
    }

    setBusyAction("logout");
    setErrorMessage(null);

    try {
      await logoutSession({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken
      });
    } catch (error) {
      handleRuntimeError(error);
    } finally {
      startTransition(() => {
        setSession(null);
        setNearbyJobs([]);
        setEnforcementStatus(null);
        setEnforcementActions([]);
        setAppealDetail(null);
        setAppealDraft("");
        setTab("home");
      });
      setBusyAction(null);
    }
  }

  async function handleWithdraw() {
    if (!session) {
      return;
    }

    if (!window.confirm("진행 중인 거래가 없을 때만 탈퇴할 수 있어요. 정말 회원 탈퇴할까요?")) {
      return;
    }

    setBusyAction("withdraw");
    setErrorMessage(null);

    try {
      const withdrawn = await withdrawMembership({
        accessToken: session.accessToken,
        reason: "미니앱 회원 탈퇴"
      });

      startTransition(() => {
        setSession(null);
        setNearbyJobs([]);
        setEnforcementStatus(null);
        setEnforcementActions([]);
        setAppealDetail(null);
        setAppealDraft("");
        setRestrictionState({
          status: "WITHDRAWN",
          title: "회원 탈퇴가 완료되었어요",
          body: `${formatDateTime(withdrawn.withdrawnAt)} 기준으로 계정이 탈퇴 처리되었어요. 재가입 정책은 운영팀 확인이 필요합니다.`,
          reasonCode: "USER_WITHDRAWN",
          supportUrl: supportKakaoChannelUrl
        });
      });
    } catch (error) {
      handleRuntimeError(error);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleResolveAdminDispute(jobId: string, resolution: "COMPLETED" | "CANCELLED" | "FAILED_SETTLEMENT") {
    if (!session?.accessToken) {
      return;
    }

    const note = window.prompt(
      "운영 메모를 남겨주세요.",
      resolution === "COMPLETED" ? "증빙과 채팅을 검토해 완료 처리" : resolution === "CANCELLED" ? "분쟁 검토 후 취소 처리" : "정산 불일치로 실패 처리"
    );

    try {
      await resolveAdminDispute({
        accessToken: session.accessToken,
        jobId,
        resolution,
        note: note ?? undefined
      });

      const [dashboard, disputes] = await Promise.all([
        fetchAdminOpsDashboard(session.accessToken),
        fetchAdminDisputes({
          accessToken: session.accessToken,
          status: adminDisputeStatusFilter,
          riskLevel: adminDisputeRiskFilter,
          query: debouncedAdminDisputeQuery,
          sort: adminDisputeSort,
          page: adminDisputePage,
          pageSize: 5
        })
      ]);
      startTransition(() => {
        setAdminDashboard(dashboard);
        setAdminDisputes(disputes.items);
        setAdminDisputeTotal(disputes.total);
        setAdminDisputeHasNextPage(disputes.hasNextPage);
        if (selectedAdminDisputeId === jobId) {
          setSelectedAdminDisputeId(null);
          setAdminDisputeDetail(null);
        }
      });
    } catch (error) {
      handleRuntimeError(error);
    }
  }

  function handleRuntimeError(error: unknown) {
    const restriction = toRestrictionState(error);
    if (restriction) {
      startTransition(() => {
        setSession(null);
        setEnforcementStatus(null);
        setEnforcementActions([]);
        setAppealDetail(null);
        setRestrictionState(restriction);
        setErrorMessage(null);
      });
      return;
    }

    setErrorMessage(toUserMessage(error));
  }

  if (restrictionState) {
    return (
      <div style={shellStyle}>
        <RestrictionScreen
          restriction={restrictionState}
          enforcementStatus={enforcementStatus}
          enforcementActions={enforcementActions}
          appealDetail={appealDetail}
          appealDraft={appealDraft}
          appealBusy={busyAction === "appeal"}
          onAppealDraftChange={setAppealDraft}
          onSubmitAppeal={async () => {
            if (!session || !enforcementStatus?.latestAction) {
              return;
            }

            setBusyAction("appeal");
            setErrorMessage(null);
            try {
              const createdAppeal = await createAppeal({
                accessToken: session.accessToken,
                actionId: enforcementStatus.latestAction.actionId,
                appealText: appealDraft
              });
              const detail = await fetchAppealDetail({
                accessToken: session.accessToken,
                appealId: createdAppeal.appealId
              });

              startTransition(() => {
                setAppealDetail(detail);
                setAppealDraft("");
              });
            } catch (error) {
              handleRuntimeError(error);
            } finally {
              setBusyAction(null);
            }
          }}
          onRetry={() => {
            setRestrictionState(null);
            setErrorMessage(null);
          }}
        />
      </div>
    );
  }

  if (!session) {
    return (
      <div style={shellStyle}>
        <LandingScreen
          busy={busyAction === "login"}
          sdkState={sdkState}
          errorMessage={errorMessage}
          onLogin={handleLogin}
        />
      </div>
    );
  }

  if (!isOperationalUserStatus(session.user.status)) {
    return (
      <div style={shellStyle}>
        <RestrictionScreen
          restriction={toSessionRestriction(session)}
          enforcementStatus={enforcementStatus}
          enforcementActions={enforcementActions}
          appealDetail={appealDetail}
          appealDraft={appealDraft}
          appealBusy={busyAction === "appeal"}
          onAppealDraftChange={setAppealDraft}
          onSubmitAppeal={async () => {
            if (!enforcementStatus?.latestAction) {
              setErrorMessage("이의제기 대상 제재를 찾을 수 없어요.");
              return;
            }

            setBusyAction("appeal");
            setErrorMessage(null);
            try {
              const createdAppeal = await createAppeal({
                accessToken: session.accessToken,
                actionId: enforcementStatus.latestAction.actionId,
                appealText: appealDraft
              });
              const detail = await fetchAppealDetail({
                accessToken: session.accessToken,
                appealId: createdAppeal.appealId
              });
              const status = await fetchEnforcementStatus(session.accessToken);

              startTransition(() => {
                setAppealDetail(detail);
                setEnforcementStatus(status);
                setAppealDraft("");
              });
            } catch (error) {
              handleRuntimeError(error);
            } finally {
              setBusyAction(null);
            }
          }}
          onRetry={() => {
            setErrorMessage(null);
            startTransition(() => {
              setSession({ ...session });
            });
          }}
        />
      </div>
    );
  }

  if (session.needsSafetyAcknowledgement) {
    return (
      <div style={shellStyle}>
        <SafetyAcknowledgementScreen
          busy={busyAction === "safety"}
          rules={safetyRules}
          errorMessage={errorMessage}
          onAcknowledge={handleSafetyAcknowledge}
        />
      </div>
    );
  }

  const tossAuthValid = Boolean(session.tossAuthValidUntil && Date.parse(session.tossAuthValidUntil) > Date.now());
  const tabItems: Array<{ key: TabKey; label: string }> = [
    { key: "home", label: "홈" },
    { key: "request", label: "심부름 요청" },
    { key: "nearby", label: "근처 의뢰" },
    { key: "active", label: "진행중 의뢰" },
    { key: "reviews", label: "후기/커뮤니티" },
    { key: "profile", label: "내 정보" }
  ];

  return (
    <div style={shellStyle}>
      <header style={heroStyle}>
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <div style={badgeRowStyle}>
            <StatusBadge label={session.user.adultVerified ? "만 19세 이상 확인" : "성인 확인 필요"} tone={session.user.adultVerified ? "brand" : "warning"} />
            <StatusBadge label="토스 로그인만 지원" tone="default" />
            <StatusBadge label="라이트 모드 기준" tone="default" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 34, color: butoTheme.colors.ink, letterSpacing: "-0.03em" }}>부토 미니앱</h1>
            <p style={{ margin: "10px 0 0", color: "#4e5968", lineHeight: 1.7, maxWidth: 680 }}>
              토스 안에서 요청, 재인증, 결제, 알림까지 끊김 없이 마무리하는 안전 우선 심부름 서비스예요.
            </p>
          </div>
          <div style={complianceStripStyle}>
            <span>주요 기능은 앱 내부에서 완료</span>
            <span>원터치 재인증은 고위험 액션 직전에만 요청</span>
            <span>권한 거절 시에도 탐색과 계정 기능은 계속 이용 가능</span>
          </div>
        </div>
        <div style={heroMetaStyle}>
          <div style={summaryTileStyle}>
            <div style={summaryLabelStyle}>고위험 액션 재인증</div>
            <strong style={summaryValueStyle}>{tossAuthValid ? "유효" : "필요"}</strong>
            <p style={summaryCopyStyle}>의뢰 생성과 결제 직전에 토스 원터치 인증을 다시 확인해요.</p>
          </div>
          <div style={summaryTileStyle}>
            <div style={summaryLabelStyle}>위치 저장 정책</div>
            <strong style={summaryValueStyle}>{productConfig.locationLogIntervalMinutes}분 간격</strong>
            <p style={summaryCopyStyle}>이동 중 위치 기록은 배터리와 분쟁 복구 균형 기준으로 관리해요.</p>
          </div>
          <div style={summaryTileStyle}>
            <div style={summaryLabelStyle}>토스 앱 환경</div>
            <strong style={summaryValueStyle}>{sdkState.appVersion ? sdkState.appVersion : "확인 중"}</strong>
            <p style={summaryCopyStyle}>원터치 인증 지원 여부를 앱 버전 기준으로 먼저 점검해요.</p>
          </div>
        </div>
      </header>

      {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

      <div style={tabStyle}>
        <TDSTab
          fluid
          size="large"
          ariaLabel="부토 미니앱 주요 화면"
          onChange={(index) => setTab(tabItems[index]?.key ?? "home")}
        >
          {tabItems.map((item) => (
            <TDSTab.Item key={item.key} selected={tab === item.key}>
              {item.label}
            </TDSTab.Item>
          ))}
        </TDSTab>
      </div>

      <main style={{ display: "grid", gap: 20 }}>
        {tab === "home" && (
          <HomeScreen
            sdkState={sdkState}
            session={session}
            notifications={notifications}
            supportFallbacks={supportFallbacks}
            adminDashboard={adminDashboard}
            adminDisputes={adminDisputes}
            adminDisputePage={adminDisputePage}
            adminDisputeTotal={adminDisputeTotal}
            adminDisputeHasNextPage={adminDisputeHasNextPage}
            adminDisputeStatusFilter={adminDisputeStatusFilter}
            adminDisputeRiskFilter={adminDisputeRiskFilter}
            adminDisputeQuery={adminDisputeQuery}
            adminDisputeSort={adminDisputeSort}
            selectedAdminDisputeId={selectedAdminDisputeId}
            adminDisputeDetail={adminDisputeDetail}
            runtimeWorkers={runtimeWorkers}
            runtimeReadiness={runtimeReadiness}
            runtimeReadinessReportMarkdown={runtimeReadinessReportMarkdown}
            runtimeReadinessActionPlanMarkdown={runtimeReadinessActionPlanMarkdown}
            runtimeReadinessEnvHandoffMarkdown={runtimeReadinessEnvHandoffMarkdown}
            releaseStatusReportMarkdown={releaseStatusReportMarkdown}
            submissionBundles={submissionBundles}
            releaseSubmissionDecision={releaseSubmissionDecision}
            submissionBundleRecommendation={submissionBundleRecommendation}
            selectedSubmissionBundleLabel={selectedSubmissionBundleLabel}
            selectedSubmissionBundleDetail={selectedSubmissionBundleDetail}
            onMarkNotificationRead={async (notificationId) => {
              try {
                const updated = await markNotificationRead({
                  accessToken: session.accessToken,
                  notificationId
                });

                startTransition(() => {
                  setNotifications((current) =>
                    current.map((item) => (item.notificationId === updated.notificationId ? updated : item))
                  );
                });
              } catch (error) {
                handleRuntimeError(error);
              }
            }}
            onAcknowledgeSupportFallback={async (fallbackId) => {
              try {
                const updated = await acknowledgeSupportFallback({
                  accessToken: session.accessToken,
                  fallbackId
                });

                startTransition(() => {
                  setSupportFallbacks((current) =>
                    current.map((item) => (item.fallbackId === updated.fallbackId ? updated : item))
                  );
                });
              } catch (error) {
                handleRuntimeError(error);
              }
            }}
            onResolveAdminDispute={(jobId, resolution) => {
              void handleResolveAdminDispute(jobId, resolution);
            }}
            onCopyOwnerEnvHandoff={async (owner) => {
              const response = await fetchRuntimeReadinessEnvHandoffByOwner({
                accessToken: session.accessToken,
                owner
              });
              return response.markdown;
            }}
            onSelectSubmissionBundle={(bundleLabel) => {
              startTransition(() => {
                setSelectedSubmissionBundleLabel(bundleLabel);
              });
            }}
            onSelectAdminDispute={(jobId) => {
              startTransition(() => {
                setSelectedAdminDisputeId((current) => (current === jobId ? null : jobId));
              });
            }}
            onAdminDisputeStatusFilterChange={(value) => {
              startTransition(() => {
                setAdminDisputeStatusFilter(value);
                setAdminDisputePage(1);
              });
            }}
            onAdminDisputeRiskFilterChange={(value) => {
              startTransition(() => {
                setAdminDisputeRiskFilter(value);
                setAdminDisputePage(1);
              });
            }}
            onAdminDisputeQueryChange={(value) => {
              startTransition(() => {
                setAdminDisputeQuery(value);
                setAdminDisputePage(1);
              });
            }}
            onAdminDisputeSortChange={(value) => {
              startTransition(() => {
                setAdminDisputeSort(value);
                setAdminDisputePage(1);
              });
            }}
            onAdminDisputePageChange={(nextPage) => {
              startTransition(() => {
                setAdminDisputePage(nextPage);
              });
            }}
            onLogout={handleLogout}
            busy={busyAction === "logout"}
          />
        )}
        {tab === "request" && (
          <CreateJobScreen
            accessToken={session.accessToken}
            sdkState={sdkState}
            tossAuthValid={tossAuthValid}
            tossAuthValidUntil={session.tossAuthValidUntil}
            busy={busyAction === "toss-auth"}
            onStartTossAuth={handleStartTossAuth}
            onRuntimeError={handleRuntimeError}
          />
        )}
        {tab === "nearby" && <NearbyJobsScreen items={nearbyJobs} loading={jobsLoading} />}
        {tab === "active" && <ActiveJobScreen accessToken={session.accessToken} sdkState={sdkState} onRuntimeError={handleRuntimeError} />}
        {tab === "reviews" && (
          <Suspense fallback={<div style={cardStyle}>후기 화면을 불러오는 중이에요.</div>}>
            <ReviewsCommunityScreen />
          </Suspense>
        )}
        {tab === "profile" && (
          <Suspense fallback={<div style={cardStyle}>내 정보 화면을 불러오는 중이에요.</div>}>
            <ProfileScreen session={session} sdkState={sdkState} onWithdraw={handleWithdraw} withdrawing={busyAction === "withdraw"} />
          </Suspense>
        )}
      </main>
    </div>
  );
}

function LandingScreen(props: {
  busy: boolean;
  sdkState: TossSdkAvailability;
  errorMessage: string | null;
  onLogin(): void;
}) {
  return (
    <section style={gridTwoColumnStyle}>
      <Panel title="부토 시작하기" subtitle="비게임 앱인토스 가이드에 맞춰 토스 로그인만 제공하고, 민감 액션은 다시 인증합니다.">
        <div style={{ display: "grid", gap: 16 }}>
          <div style={featureCardStyle}>
            <StatusBadge label={props.sdkState.available ? "SDK 감지됨" : "SDK 미설치"} tone={props.sdkState.available ? "brand" : "warning"} />
            <h3 style={{ margin: "14px 0 6px", color: butoTheme.colors.ink }}>토스 로그인만 지원해요</h3>
            <p style={{ margin: 0, color: "#4e5968", lineHeight: 1.7 }}>
              `appLogin()`으로 받은 인가 코드는 서버가 교환하고, 자사 로그인이나 외부 가입 화면은 두지 않아요.
            </p>
          </div>
          <div style={featureCardStyle}>
            <StatusBadge label="원터치 재인증" tone="brand" />
            <h3 style={{ margin: "14px 0 6px", color: butoTheme.colors.ink }}>고위험 액션 직전에만 다시 확인해요</h3>
            <p style={{ margin: 0, color: "#4e5968", lineHeight: 1.7 }}>
              의뢰 생성, 결제 승인 같은 민감 단계는 토스 원터치 인증으로 다시 확인하고 성공 결과는 서버가 최종 조회합니다.
            </p>
          </div>
          <div style={featureCardStyle}>
            <StatusBadge label="권한 최소 요청" tone="default" />
            <h3 style={{ margin: "14px 0 6px", color: butoTheme.colors.ink }}>권한은 필요한 순간에만 요청해요</h3>
            <p style={{ margin: 0, color: "#4e5968", lineHeight: 1.7 }}>
              위치, 카메라, 사진첩은 목적을 먼저 설명한 뒤 요청하고, 거절해도 로그인과 기본 탐색은 계속 사용할 수 있어요.
            </p>
          </div>
          <TDSButton color="primary" variant="fill" size="xlarge" display="full" loading={props.busy} onClick={props.onLogin}>
            토스 로그인 시작
          </TDSButton>
          {props.errorMessage ? <ErrorBanner message={props.errorMessage} /> : null}
        </div>
      </Panel>
      <Panel title="심사 전제" subtitle="앱인토스 등록·심사 기준에서 직접 걸리는 항목만 화면에 드러나게 정리했어요.">
        <ul style={listStyle}>
          <li>주요 기능은 토스 앱 안에서 완료되고, 외부 링크는 상담·법정 고지 같은 예외 상황에만 사용해요.</li>
          <li>다크 모드 전환 UI는 두지 않고, 라이트 모드 기준 대비와 계층을 유지해요.</li>
          <li>권한 목적, 안전수칙, AI 안전 필터 사용 사실을 사용자에게 먼저 설명해요.</li>
        </ul>
      </Panel>
    </section>
  );
}

function RestrictionScreen(props: {
  restriction: RestrictionState;
  enforcementStatus: EnforcementStatusSummary | null;
  enforcementActions: EnforcementActionWithEvidence[];
  appealDetail: AppealDetail | null;
  appealDraft: string;
  appealBusy: boolean;
  onAppealDraftChange(value: string): void;
  onSubmitAppeal(): void;
  onRetry(): void;
}) {
  const [showReasonDetails, setShowReasonDetails] = useState(false);
  const latestAction = props.enforcementStatus?.latestAction ?? props.enforcementActions[0];
  const evidenceBundle = latestAction && "evidenceBundle" in latestAction ? latestAction.evidenceBundle : undefined;
  const latestAppeal = props.appealDetail ?? props.enforcementStatus?.latestAppeal;
  const canAppeal = props.restriction.status !== "WITHDRAWN" && !latestAppeal && Boolean(latestAction?.actionId);

  return (
    <section style={gridTwoColumnStyle}>
      <Panel title={props.restriction.title} subtitle="운영정책 또는 계정 상태로 인해 현재 이용이 제한되어 있어요.">
        <div style={{ display: "grid", gap: 16 }}>
          <div style={warningCardStyle}>
            <StatusBadge
              label={props.restriction.status === "WITHDRAWN" ? "탈퇴 처리" : "운영정책 제한"}
              tone="warning"
            />
            <h3 style={{ margin: "14px 0 8px", color: "#7f1d1d" }}>계정 이용이 일시 제한되었어요</h3>
            <p style={{ margin: "12px 0 0", lineHeight: 1.6, color: "#7f1d1d" }}>{props.restriction.body}</p>
            <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
              {props.restriction.reasonCode ? <Field label="제재 사유 코드" value={props.restriction.reasonCode} /> : null}
              {props.restriction.scope ? <Field label="제한 범위" value={formatScope(props.restriction.scope)} /> : null}
              {props.restriction.reviewStatus ? (
                <Field label="검토 상태" value={formatReviewStatus(String(props.restriction.reviewStatus))} />
              ) : null}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {canAppeal ? (
              <TDSButton
                color="primary"
                variant="fill"
                size="large"
                loading={props.appealBusy}
                disabled={!props.appealDraft.trim()}
                onClick={props.onSubmitAppeal}
              >
                이의제기 제출
              </TDSButton>
            ) : null}
            <TDSButton color="dark" variant="weak" size="large" onClick={() => setShowReasonDetails((current) => !current)}>
              {showReasonDetails ? "제재 사유 닫기" : "제재 사유 보기"}
            </TDSButton>
            <TDSButton color="dark" variant="weak" size="large" onClick={props.onRetry}>
              상태 새로고침
            </TDSButton>
            <TDSTextButton
              as="a"
              href={props.restriction.supportUrl ?? "#"}
              size="large"
              style={{
                pointerEvents: props.restriction.supportUrl ? "auto" : "none",
                opacity: props.restriction.supportUrl ? 1 : 0.45
              }}
            >
              카카오톡 채널 상담
            </TDSTextButton>
          </div>
          {canAppeal ? (
            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontWeight: 700, color: butoTheme.colors.ink }}>이의제기 내용</span>
              <textarea
                value={props.appealDraft}
                onChange={(event) => props.onAppealDraftChange(event.target.value)}
                rows={5}
                placeholder="오탐 또는 사정 변경이 있다면 구체적으로 적어주세요."
                style={textareaStyle}
              />
            </label>
          ) : null}
          {latestAppeal ? (
            <div style={cardStyle}>
              <StatusBadge label={`이의제기 ${formatAppealStatus(latestAppeal.status)}`} tone="brand" />
              <p style={{ margin: "12px 0 0", color: "#57534e", lineHeight: 1.6 }}>
                제출 시각: {formatDateTime(latestAppeal.submittedAt)}
              </p>
              {"appealText" in latestAppeal ? (
                <p style={{ margin: "10px 0 0", color: "#44403c", lineHeight: 1.6 }}>{latestAppeal.appealText}</p>
              ) : null}
            </div>
          ) : null}
          {showReasonDetails ? (
            <div style={cardStyle}>
              <strong>최근 제재 사유</strong>
              <p style={{ margin: "10px 0 0", color: "#57534e", lineHeight: 1.6 }}>
                {latestAction?.reasonMessage ?? props.restriction.body}
              </p>
              {evidenceBundle && typeof evidenceBundle === "object" ? (
                <p style={{ margin: "10px 0 0", color: "#78716c", lineHeight: 1.6 }}>
                  증거 요약: {"summary" in evidenceBundle && typeof evidenceBundle.summary === "string" ? evidenceBundle.summary : "운영 검토용 증거가 접수되었어요."}
                </p>
              ) : null}
            </div>
          ) : null}
          {!props.restriction.supportUrl ? (
            <p style={{ margin: 0, color: "#7c2d12" }}>
              `VITE_BUTO_SUPPORT_KAKAOTALK_URL` 설정이 필요해요. 실제 카카오톡 채널 URL을 연결해 주세요.
            </p>
          ) : null}
        </div>
      </Panel>
      <Panel title="운영 메모" subtitle="자동 영구정지보다 즉시 잠금과 수동 판정이 우선입니다.">
        <ul style={listStyle}>
          <li>자동 제재는 즉시 잠금과 증거 고정까지만 수행하고, 영구정지는 제한된 중대 사유만 허용합니다.</li>
          <li>정지 해제는 사용자를 다른 테이블로 옮기지 않고 `users.status`를 바꾸며 이력은 삭제하지 않습니다.</li>
          <li>회원 탈퇴 계정도 `users.status=WITHDRAWN`으로 남고, 진행 중 거래가 있으면 탈퇴할 수 없습니다.</li>
        </ul>
      </Panel>
    </section>
  );
}

function SafetyAcknowledgementScreen(props: {
  busy: boolean;
  rules: SafetyRuleDocument | null;
  errorMessage: string | null;
  onAcknowledge(): void;
}) {
  const ruleItems = props.rules?.items ?? [
    "집 주소, 상세 동호수, 공동현관 비밀번호, 계좌 비밀번호, 신분증 사진은 채팅으로 보내지 마세요.",
    "현금 전달, 통장/카드/OTP 전달, 술·담배·약 전달 요청은 바로 중단하고 신고해 주세요.",
    "위협, 강요, 성희롱, 목적지 변경 강요가 있으면 진행을 멈추고 긴급 버튼을 눌러주세요.",
    "불법·협박·부적절 대화가 확인되면 의뢰가 중단되고 계정이 제한될 수 있어요."
  ];

  return (
    <section style={safetyScreenStyle}>
      <div>
        <StatusBadge label="안전수칙 필수" tone="warning" />
        <h1 style={{ fontSize: 40, margin: "18px 0 10px", color: butoTheme.colors.ink }}>안전하게 이용해주세요</h1>
        <p style={{ fontSize: 18, lineHeight: 1.6, margin: 0, color: "#57534e" }}>
          부토는 실제 사람을 만나고 물건을 전달하는 서비스예요. 로그인할 때마다 아래 수칙을 다시 확인해야 합니다.
        </p>
      </div>
      <div style={inlineNoticeStyle}>
        권한과 인증은 필요한 순간마다 다시 요청될 수 있고, AI 안전 필터가 욕설·개인정보·불법 요청을 탐지할 수 있어요.
      </div>
      <div style={{ display: "grid", gap: 16 }}>
        {ruleItems.map((item, index) => (
          <SafetyCard key={item} title={`안전수칙 ${index + 1}`} body={item} />
        ))}
      </div>
      {props.errorMessage ? <ErrorBanner message={props.errorMessage} /> : null}
      <TDSButton color="primary" variant="fill" size="xlarge" display="full" loading={props.busy} onClick={props.onAcknowledge}>
        확인했습니다
      </TDSButton>
    </section>
  );
}

function HomeScreen(props: {
  sdkState: TossSdkAvailability;
  session: SessionState;
  notifications: NotificationRecord[];
  supportFallbacks: SupportFallbackRecord[];
  adminDashboard: AdminOpsDashboard | null;
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
  onMarkNotificationRead(notificationId: string): void;
  onAcknowledgeSupportFallback(fallbackId: string): void;
  onResolveAdminDispute(jobId: string, resolution: "COMPLETED" | "CANCELLED" | "FAILED_SETTLEMENT"): void;
  onCopyOwnerEnvHandoff(owner: RuntimeReadinessSummary["owners"][number]["owner"]): Promise<string>;
  onSelectSubmissionBundle(bundleLabel: string): void;
  onSelectAdminDispute(jobId: string): void;
  onAdminDisputeStatusFilterChange(value: "ALL" | "DISPUTED" | "CLIENT_CONFIRM_PENDING" | "DELIVERY_PROOF_SUBMITTED"): void;
  onAdminDisputeRiskFilterChange(value: "ALL" | "LOW" | "MEDIUM" | "HIGH"): void;
  onAdminDisputeQueryChange(value: string): void;
  onAdminDisputeSortChange(value: "job_id_desc" | "risk_desc" | "status_asc" | "title_asc"): void;
  onAdminDisputePageChange(nextPage: number): void;
  busy: boolean;
  onLogout(): void;
}) {
  const unreadCount = props.notifications.filter((notification) => !notification.readAt).length;

  return (
    <section style={gridTwoColumnStyle}>
      <Panel title="서비스 원칙" subtitle="앱인토스 비게임 가이드에 맞춰 주요 흐름을 앱 안에서 끝내도록 설계했어요.">
        <div style={{ display: "grid", gap: 12 }}>
          <QuickAction title="토스 로그인만 지원" body="별도 회원가입이나 외부 가입 링크 없이 토스 로그인으로만 진입해요." />
          <QuickAction title="주요 기능은 앱 내 완료" body="요청, 재인증, 결제, 알림, 제재 확인까지 토스 앱 안에서 마무리해요." />
          <QuickAction title="AI 안전 필터 사용" body="채팅과 신고 처리에는 AI 기반 안전 필터와 운영 검토가 함께 사용돼요." />
          <QuickAction title="거래 불발 환불 원칙" body="픽업 전 거래 불발로 취소되면 결제는 클라이언트 결제수단으로 환불돼요." />
        </div>
      </Panel>
      <Panel title="세션 상태" subtitle="민감 정보는 짧게 유지하고, 고위험 단계에서는 재인증을 요구해요.">
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="닉네임" value={props.session.user.nickname} />
          <Field label="계정 상태" value={props.session.user.status} />
          <Field label="토스 앱 버전" value={props.sdkState.appVersion ?? "확인 불가"} />
          <Field label="읽지 않은 알림" value={`${unreadCount}건`} />
          <button style={secondaryButtonStyle} onClick={props.onLogout} disabled={props.busy}>
            {props.busy ? "로그아웃 중..." : "로그아웃"}
          </button>
        </div>
      </Panel>
      <Panel title="권한 사용 안내" subtitle="권한 요청 전에 목적을 먼저 설명하고, 거절해도 기본 기능은 계속 사용할 수 있게 설계했어요.">
        <div style={{ display: "grid", gap: 12 }}>
          <article style={featureCardStyle}>
            <strong>위치 권한</strong>
            <p style={featureBodyStyle}>근처 의뢰와 진행 중 증빙 기록에만 사용해요. 거절하면 근처 탐색 정확도와 도착 기록 기능이 제한돼요.</p>
          </article>
          <article style={featureCardStyle}>
            <strong>카메라 권한</strong>
            <p style={featureBodyStyle}>픽업·전달 증빙 사진 촬영에 사용해요. 거절하면 업로드 대신 다른 완료 수단이 제공되지 않아요.</p>
          </article>
          <article style={featureCardStyle}>
            <strong>사진첩 권한</strong>
            <p style={featureBodyStyle}>이미 찍어 둔 증빙 사진 선택에만 사용해요. 읽기 권한만 선언하고, 주요 흐름은 카메라 없이도 유지됩니다.</p>
          </article>
        </div>
      </Panel>
      <Panel title="알림함" subtitle="제재, 이의제기, 매칭, 증빙, 분쟁 결과를 여기에서 다시 확인할 수 있어요.">
        <ul style={listResetStyle}>
          {props.notifications.length === 0 ? <div style={cardStyle}>도착한 알림이 아직 없어요.</div> : null}
          {props.notifications.slice(0, 5).map((notification) => (
            <TDSListRow
              key={notification.notificationId}
              border="none"
              verticalPadding="large"
              horizontalPadding="small"
              style={{
                ...cardStyle,
                borderColor: notification.readAt ? "#e5e8eb" : "#dbeafe",
                background: notification.readAt ? "#ffffff" : "#f8fbff"
              }}
              contents={
                <TDSListRow.Texts
                  type="2RowTypeA"
                  top={notification.title}
                  bottom={`${notification.body} · ${formatDateTime(notification.createdAt)}`}
                />
              }
              right={
                <TDSButton
                  size="small"
                  variant="weak"
                  color="dark"
                  disabled={Boolean(notification.readAt)}
                  onClick={() => props.onMarkNotificationRead(notification.notificationId)}
                >
                  {notification.readAt ? "읽음" : "읽음 처리"}
                </TDSButton>
              }
            />
          ))}
        </ul>
      </Panel>
      {props.session.user.roleFlags.includes("ADMIN") && props.adminDashboard ? (
        <Suspense fallback={<div style={cardStyle}>운영 패널을 불러오는 중이에요.</div>}>
          <AdminOperationsPanel
            adminDashboard={props.adminDashboard}
            adminDisputes={props.adminDisputes}
            adminDisputePage={props.adminDisputePage}
            adminDisputeTotal={props.adminDisputeTotal}
            adminDisputeHasNextPage={props.adminDisputeHasNextPage}
            adminDisputeStatusFilter={props.adminDisputeStatusFilter}
            adminDisputeRiskFilter={props.adminDisputeRiskFilter}
            adminDisputeQuery={props.adminDisputeQuery}
            adminDisputeSort={props.adminDisputeSort}
            selectedAdminDisputeId={props.selectedAdminDisputeId}
            adminDisputeDetail={props.adminDisputeDetail}
            runtimeWorkers={props.runtimeWorkers}
            runtimeReadiness={props.runtimeReadiness}
            runtimeReadinessReportMarkdown={props.runtimeReadinessReportMarkdown}
            runtimeReadinessActionPlanMarkdown={props.runtimeReadinessActionPlanMarkdown}
            runtimeReadinessEnvHandoffMarkdown={props.runtimeReadinessEnvHandoffMarkdown}
            releaseStatusReportMarkdown={props.releaseStatusReportMarkdown}
            submissionBundles={props.submissionBundles}
            releaseSubmissionDecision={props.releaseSubmissionDecision}
            submissionBundleRecommendation={props.submissionBundleRecommendation}
            selectedSubmissionBundleLabel={props.selectedSubmissionBundleLabel}
            selectedSubmissionBundleDetail={props.selectedSubmissionBundleDetail}
            onResolveAdminDispute={props.onResolveAdminDispute}
            onCopyOwnerEnvHandoff={props.onCopyOwnerEnvHandoff}
            onSelectSubmissionBundle={props.onSelectSubmissionBundle}
            onSelectAdminDispute={props.onSelectAdminDispute}
            onAdminDisputeStatusFilterChange={props.onAdminDisputeStatusFilterChange}
            onAdminDisputeRiskFilterChange={props.onAdminDisputeRiskFilterChange}
            onAdminDisputeQueryChange={props.onAdminDisputeQueryChange}
            onAdminDisputeSortChange={props.onAdminDisputeSortChange}
            onAdminDisputePageChange={props.onAdminDisputePageChange}
          />
        </Suspense>
      ) : null}
      <Panel title="상담 채널 안내" subtitle="주요 기능은 앱 안에서 끝나지만, 예외 상황에서는 고객센터 채널 안내를 남겨요.">
        <ul style={listResetStyle}>
          {props.supportFallbacks.length === 0 ? <div style={cardStyle}>현재 필요한 상담 채널 전환 안내가 없어요.</div> : null}
          {props.supportFallbacks.slice(0, 3).map((fallback) => (
            <TDSListRow
              key={fallback.fallbackId}
              border="none"
              verticalPadding="large"
              horizontalPadding="small"
              style={{
                ...cardStyle,
                borderColor: fallback.status === "OPEN" ? "#fdba74" : "#e5e8eb",
                background: fallback.status === "OPEN" ? "#fff7ed" : "#ffffff"
              }}
              contents={
                <TDSListRow.Texts
                  type="2RowTypeA"
                  top="카카오톡 채널 상담 안내"
                  bottom={`${fallback.reasonMessage} · ${formatDateTime(fallback.createdAt)}`}
                />
              }
              right={
                <div style={{ display: "grid", gap: 8 }}>
                  <TDSTextButton
                    as="a"
                    href={supportKakaoChannelUrl ?? "#"}
                    size="medium"
                    style={{
                      pointerEvents: supportKakaoChannelUrl ? "auto" : "none",
                      opacity: supportKakaoChannelUrl ? 1 : 0.45
                    }}
                  >
                    상담 열기
                  </TDSTextButton>
                  <TDSButton
                    size="small"
                    variant="weak"
                    color="dark"
                    disabled={fallback.status === "ACKNOWLEDGED"}
                    onClick={() => props.onAcknowledgeSupportFallback(fallback.fallbackId)}
                  >
                    {fallback.status === "ACKNOWLEDGED" ? "확인됨" : "안내 확인"}
                  </TDSButton>
                </div>
              }
            />
          ))}
        </ul>
      </Panel>
    </section>
  );
}

function CreateJobScreen(props: {
  accessToken: string;
  sdkState: TossSdkAvailability;
  tossAuthValid: boolean;
  tossAuthValidUntil?: string;
  busy: boolean;
  onStartTossAuth(): void;
  onRuntimeError(error: unknown): void;
}) {
  const [requestBusy, setRequestBusy] = useState(false);
  const [paymentSummary, setPaymentSummary] = useState<string | null>(null);

  const sampleDraft = {
    title: "장보기 전달 부탁드려요",
    description: "마트 생활용품을 집 앞까지 전달해주세요.",
    pickup: { address: "서울 서초구 서초동", lat: 37.4919, lng: 127.0076 },
    dropoff: { address: "서울 강남구 역삼동", lat: 37.5007, lng: 127.0366 },
    transportRequirement: "walk" as const,
    offerAmount: 18000
  };

  async function completeOneTouch(intent: "JOB_CREATE" | "PAYMENT_CONFIRM") {
    if (!props.sdkState.available) {
      throw new Error("토스 앱 WebView에서만 원터치 인증과 결제가 동작해요.");
    }

    if (!props.sdkState.supportsOneTouch) {
      throw new Error(`토스 앱 ${props.sdkState.appVersion ?? "구버전"}에서는 원터치 인증을 지원하지 않아요.`);
    }

    const started = await startSensitiveFaceAuth({
      accessToken: props.accessToken,
      intent
    });
    if (!started.txId) {
      throw new Error("원터치 인증 txId를 받지 못했어요.");
    }

    await openTossOneTouch(started.txId);
    const completed = await completeSensitiveFaceAuth({
      accessToken: props.accessToken,
      faceAuthSessionId: started.faceAuthSessionId
    });

    if (!completed.verified) {
      throw new Error(`원터치 인증이 완료되지 않았어요. 상태: ${completed.riskCode}`);
    }

    return started.faceAuthSessionId;
  }

  async function handleCreateAndPay() {
    setRequestBusy(true);
    setPaymentSummary(null);

    try {
      const jobCreateFaceAuthSessionId = await completeOneTouch("JOB_CREATE");
      const createdJob = await createJobRequest({
        accessToken: props.accessToken,
        faceAuthSessionId: jobCreateFaceAuthSessionId,
        ...sampleDraft
      });

      const startedPayment = await initJobPayment({
        accessToken: props.accessToken,
        jobId: createdJob.jobId
      });

      if (!startedPayment.payToken) {
        throw new Error("토스페이 payToken을 받지 못했어요.");
      }

      const checkout = await checkoutTossPayment(startedPayment.payToken);
      if (!checkout.success) {
        setPaymentSummary(`결제 인증이 중단되었어요. 사유: ${checkout.reason ?? "USER_CANCELED"}`);
        return;
      }

      const paymentConfirmFaceAuthSessionId = await completeOneTouch("PAYMENT_CONFIRM");

      try {
        const confirmed = await confirmJobPayment({
          accessToken: props.accessToken,
          jobId: createdJob.jobId,
          paymentOrderId: startedPayment.paymentOrderId,
          faceAuthSessionId: paymentConfirmFaceAuthSessionId
        });
        setPaymentSummary(
          `승인 완료 · 총 ${startedPayment.amount.toLocaleString("ko-KR")}원 중 심부름 대금 ${confirmed.heldAmount.toLocaleString("ko-KR")}원, 수수료 ${confirmed.feeAmount.toLocaleString("ko-KR")}원을 서버 ledger에 분리 보관했어요.`
        );
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "PAYMENT_CONFIRM_PENDING") {
          const reconciled = await reconcileJobPayment({
            accessToken: props.accessToken,
            jobId: createdJob.jobId,
            paymentOrderId: startedPayment.paymentOrderId
          });
          setPaymentSummary(
            `승인 응답이 지연되어 상태조회로 복구했어요. 상태 ${reconciled.paymentStatus}, 거래번호 ${reconciled.transactionId ?? "확인 중"}`
          );
          return;
        }

        throw error;
      }
    } catch (error) {
      props.onRuntimeError(error);
    } finally {
      setRequestBusy(false);
    }
  }

  return (
    <section style={gridTwoColumnStyle}>
      <Panel title="심부름 요청하기" subtitle="비게임 심사 기준에 맞춰 저위험 생활 심부름만 앱 안에서 완결되게 설계했어요.">
        <div style={{ display: "grid", gap: 16 }}>
          <Field label="제목" value={sampleDraft.title} />
          <Field label="설명" value={sampleDraft.description} multiline />
          <Field label="출발지" value={sampleDraft.pickup.address} />
          <Field label="도착지" value={sampleDraft.dropoff.address} />
          <Field label="요청 금액" value={`${sampleDraft.offerAmount.toLocaleString("ko-KR")}원`} />
          <div style={featureCardStyle}>
            <StatusBadge label="권한 사전 안내" tone="default" />
            <p style={featureBodyStyle}>
              위치 권한은 근처 의뢰 탐색과 도착 기록, 카메라와 사진첩 권한은 완료 증빙용으로만 사용돼요. 권한 요청은 실제 기능 직전에만 보여줍니다.
            </p>
          </div>
          <div style={cardStyle}>
            <StatusBadge label={props.tossAuthValid ? "토스 원터치 인증 완료" : "토스 원터치 인증 필요"} tone={props.tossAuthValid ? "brand" : "warning"} />
            <p style={{ margin: "12px 0 0", color: "#4e5968", lineHeight: 1.7 }}>
              의뢰 생성과 결제 승인은 토스 앱 원터치 인증 성공 후 {productConfig.faceAuthWindowMinutes}분 이내에만 가능해요. 토스 앱 안에서 PIN 또는 단말 생체인증이 사용될 수 있습니다.
            </p>
            <p style={{ margin: "12px 0 0", color: "#8b95a1" }}>
              인증 유효 시각: {props.tossAuthValidUntil ? formatDateTime(props.tossAuthValidUntil) : "없음"}
            </p>
            <TDSButton
              color="dark"
              variant="weak"
              size="large"
              display="full"
              loading={props.busy}
              onClick={props.onStartTossAuth}
            >
              토스 원터치 인증 시작
            </TDSButton>
          </div>
        </div>
      </Panel>
      <Panel title="결제 및 정책 검사" subtitle="토스페이 인증 성공만으로 결제가 끝난 것으로 보지 않고, 서버 승인과 정책 검사를 함께 통과해야 해요.">
        <ul style={listStyle}>
          <li>금칙어, 은어, 야간 고액 패턴을 서버에서 동기 검사해요.</li>
          <li>클라이언트 인증 성공만으로 결제를 완료로 보지 않고, 서버가 `execute-payment`와 상태조회로 최종 확정해요.</li>
          <li>주소 원문은 근처 의뢰 목록에 노출하지 않고, 적합한 조건의 부르미에게만 매칭해요.</li>
          <li>수수료는 서버 ledger에 별도 필드로 남기고, 정산 시 심부름 대금과 분리해 관리해요.</li>
          <li>거래가 픽업 전에 불발되면 환불 사유를 서버에서 정규화해 클라이언트 결제수단으로 환불해요.</li>
          <li>의뢰자가 취소를 원하면 부르미 동의가 먼저 필요하고, 개인 대화 20분 무응답 자동 파기는 부르미 도착 알림 전 단계에만 적용돼요.</li>
        </ul>
        <TDSButton color="primary" variant="fill" size="xlarge" display="full" loading={requestBusy} disabled={!props.sdkState.available} onClick={() => void handleCreateAndPay()}>
          결제하고 요청 올리기
        </TDSButton>
        {paymentSummary ? <p style={{ margin: "14px 0 0", color: "#0f172a", lineHeight: 1.7 }}>{paymentSummary}</p> : null}
      </Panel>
    </section>
  );
}

function NearbyJobsScreen(props: { items: JobCard[]; loading: boolean }) {
  return (
    <Panel title="근처 의뢰" subtitle="주소 원문 없이 노출 가능한 카드 정보만 보여줍니다.">
      {props.loading ? <p style={{ margin: 0, color: "#57534e" }}>의뢰를 불러오는 중이에요...</p> : null}
      <ul style={listResetStyle}>
        {!props.loading && props.items.length === 0 ? <div style={cardStyle}>노출 가능한 근처 의뢰가 없어요.</div> : null}
        {props.items.map((item) => (
          <TDSListRow
            key={item.jobId}
            border="none"
            verticalPadding="large"
            horizontalPadding="small"
            style={cardStyle}
            contents={
              <TDSListRow.Texts
                type="2RowTypeA"
                top={item.title}
                bottom={`${item.distanceKm.toFixed(1)}km · ${item.transportRequirement} · ${item.status}`}
              />
            }
            right={
              <div style={{ textAlign: "right" }}>
                <StatusBadge label={item.riskLevel} tone={item.riskLevel === "LOW" ? "brand" : "warning"} />
                <div style={{ marginTop: 8, fontWeight: 700 }}>{item.offerAmount.toLocaleString("ko-KR")}원</div>
              </div>
            }
          />
        ))}
      </ul>
    </Panel>
  );
}

function ActiveJobScreen(props: {
  accessToken: string;
  sdkState: TossSdkAvailability;
  onRuntimeError(error: unknown): void;
}) {
  const [activeJobs, setActiveJobs] = useState<ActiveJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<Array<{ id: string; dataUri: string }>>([]);
  const [lastLocationSummary, setLastLocationSummary] = useState<string | null>(null);
  const [lastProofSummary, setLastProofSummary] = useState<string | null>(null);
  const [lastCancellationSummary, setLastCancellationSummary] = useState<string | null>(null);
  const [watchingLocation, setWatchingLocation] = useState(false);
  const locationWatchCleanupRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      setLoading(true);
      try {
        const response = await fetchActiveJobs(props.accessToken);
        if (disposed) {
          return;
        }

        startTransition(() => {
          setActiveJobs(response.items);
          setSelectedJobId((current) => current ?? response.items[0]?.jobId ?? null);
        });
      } catch (error) {
        if (!disposed) {
          props.onRuntimeError(error);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  }, [props.accessToken]);

  useEffect(() => {
    return () => {
      locationWatchCleanupRef.current?.();
      locationWatchCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!watchingLocation) {
      return;
    }

    locationWatchCleanupRef.current?.();
    locationWatchCleanupRef.current = null;
    setWatchingLocation(false);
    setLastLocationSummary("선택한 의뢰가 바뀌어 위치 추적을 중지했어요.");
  }, [selectedJobId]);

  const selectedJob = activeJobs.find((item) => item.jobId === selectedJobId) ?? activeJobs[0] ?? null;
  const canUseSdk = props.sdkState.available;
  const canUploadPickup = selectedJob ? ["RUNNER_ARRIVED", "PICKED_UP"].includes(selectedJob.status) : false;
  const canUploadDelivery = selectedJob ? selectedJob.status === "DELIVERING" : false;
  const canRequestMutualCancellation = selectedJob ? selectedJob.isClientView && ["MATCHED", "RUNNER_EN_ROUTE", "RUNNER_ARRIVED"].includes(selectedJob.status) : false;
  const canRespondMutualCancellation = selectedJob
    ? selectedJob.isRunnerView && selectedJob.cancellationRequest?.status === "PENDING_RUNNER_CONFIRMATION"
    : false;
  const agreementAlert = getAgreementAlert(selectedJob);
  const disputeAlert = getDisputeAlert(selectedJob);
  const canEscalateToDispute = selectedJob ? selectedJob.isClientView && selectedJob.status === "CLIENT_CONFIRM_PENDING" : false;
  const canRequestOpsReview = selectedJob ? Boolean(selectedJob.counterpartUserId) && ["PICKED_UP", "DELIVERING", "DELIVERY_PROOF_SUBMITTED"].includes(selectedJob.status) : false;

  async function refreshActiveJobs() {
    const response = await fetchActiveJobs(props.accessToken);
    startTransition(() => {
      setActiveJobs(response.items);
      setSelectedJobId((current) => current && response.items.some((item) => item.jobId === current) ? current : response.items[0]?.jobId ?? null);
    });
  }

  async function handleRecordLocation(source: "app" | "background" | "manual") {
    if (!selectedJob) {
      return;
    }

    setBusyLabel(source === "manual" ? "현재 위치 기록 중" : "위치 업데이트 저장 중");
    try {
      await ensureSdkPermission({
        available: canUseSdk,
        getPermission: getLocationPermission,
        openPermissionDialog: openLocationPermissionDialog,
        permissionName: "위치"
      });

      const location = await readCurrentLocation(3);
      const saved = await logJobLocation({
        accessToken: props.accessToken,
        jobId: selectedJob.jobId,
        lat: location.lat,
        lng: location.lng,
        accuracy: location.accuracy,
        source
      });

      startTransition(() => {
        setLastLocationSummary(`${formatDateTime(saved.loggedAt)} · ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)} · 정확도 ${Math.round(location.accuracy)}m`);
      });
      await refreshActiveJobs();
    } catch (error) {
      props.onRuntimeError(error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function toggleLocationWatch() {
    if (!selectedJob) {
      return;
    }

    if (watchingLocation) {
      locationWatchCleanupRef.current?.();
      locationWatchCleanupRef.current = null;
      setWatchingLocation(false);
      setLastLocationSummary("백그라운드 위치 추적을 중지했어요.");
      return;
    }

    setBusyLabel("위치 추적 시작 중");
    try {
      await ensureSdkPermission({
        available: canUseSdk,
        getPermission: getLocationPermission,
        openPermissionDialog: openLocationPermissionDialog,
        permissionName: "위치"
      });

      locationWatchCleanupRef.current = await startLocationUpdates({
        timeInterval: productConfig.locationLogIntervalMinutes * 60_000,
        distanceInterval: 30,
        onLocation: (location) => {
          void logJobLocation({
            accessToken: props.accessToken,
            jobId: selectedJob.jobId,
            lat: location.lat,
            lng: location.lng,
            accuracy: location.accuracy,
            source: "background"
          }).then((saved) => {
            startTransition(() => {
              setLastLocationSummary(`${formatDateTime(saved.loggedAt)} · 위치 추적 이벤트 저장됨`);
            });
          }).catch((error) => {
            props.onRuntimeError(error);
          });
        },
        onError: (error) => {
          props.onRuntimeError(error);
          setWatchingLocation(false);
        }
      });
      setWatchingLocation(true);
      setLastLocationSummary(`${productConfig.locationLogIntervalMinutes}분 간격 위치 추적을 시작했어요.`);
    } catch (error) {
      props.onRuntimeError(error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleCaptureProof(proofType: "pickup" | "delivery") {
    if (!selectedJob) {
      return;
    }

    setBusyLabel(proofType === "pickup" ? "픽업 사진 준비 중" : "배송 사진 준비 중");
    try {
      await ensureSdkPermission({
        available: canUseSdk,
        getPermission: getCameraPermission,
        openPermissionDialog: openCameraPermissionDialog,
        permissionName: "카메라"
      });

      const image = await captureCameraImage({ maxWidth: 1280 });
      await uploadProofWorkflow({
        accessToken: props.accessToken,
        jobId: selectedJob.jobId,
        proofType,
        source: "camera",
        image,
        onCompleted: async (summary) => {
          startTransition(() => {
            setLastProofSummary(summary);
            setAlbumPhotos([]);
          });
          await refreshActiveJobs();
        }
      });
    } catch (error) {
      props.onRuntimeError(error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleLoadAlbumPhotos() {
    setBusyLabel("사진첩 불러오는 중");
    try {
      await ensureSdkPermission({
        available: canUseSdk,
        getPermission: getPhotosPermission,
        openPermissionDialog: openPhotosPermissionDialog,
        permissionName: "사진첩"
      });

      const photos = await fetchRecentAlbumPhotos({ maxCount: 4, maxWidth: 1280 });
      startTransition(() => {
        setAlbumPhotos(photos);
      });
    } catch (error) {
      props.onRuntimeError(error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleUploadAlbumProof(proofType: "pickup" | "delivery", image: { id: string; dataUri: string }) {
    if (!selectedJob) {
      return;
    }

    setBusyLabel("앨범 사진 업로드 중");
    try {
      await uploadProofWorkflow({
        accessToken: props.accessToken,
        jobId: selectedJob.jobId,
        proofType,
        source: "album",
        image,
        onCompleted: async (summary) => {
          startTransition(() => {
            setLastProofSummary(summary);
            setAlbumPhotos([]);
          });
          await refreshActiveJobs();
        }
      });
    } catch (error) {
      props.onRuntimeError(error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleRequestCancellation() {
    if (!selectedJob) {
      return;
    }

    const reason = window.prompt("부르미에게 보낼 취소 사유를 적어주세요.", "일정 조율 실패로 거래를 이어가기 어려워요.");
    if (!reason) {
      return;
    }

    if (!window.confirm("부르미 동의가 있어야만 픽업 전 거래를 취소하고 환불할 수 있어요. 요청할까요?")) {
      return;
    }

    setBusyLabel("취소 요청 전송 중");
    try {
      const requested = await requestJobCancellation({
        accessToken: props.accessToken,
        jobId: selectedJob.jobId,
        reason
      });
      startTransition(() => {
        setLastCancellationSummary(`${formatDateTime(requested.requestedAt)} · 합의 취소 요청을 보냈어요.`);
      });
      await refreshActiveJobs();
    } catch (error) {
      props.onRuntimeError(error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleRespondCancellation(decision: "ACCEPT" | "REJECT") {
    if (!selectedJob?.cancellationRequest) {
      return;
    }

    const note = window.prompt(
      decision === "ACCEPT" ? "취소 수락 메모가 있으면 적어주세요." : "거절 사유가 있으면 적어주세요.",
      decision === "ACCEPT" ? "부르미와 의뢰자가 거래 불발에 합의했어요." : "현재는 거래를 계속 진행할 수 있어요."
    );

    setBusyLabel(decision === "ACCEPT" ? "취소 합의 처리 중" : "취소 거절 처리 중");
    try {
      const responded = await respondJobCancellation({
        accessToken: props.accessToken,
        jobId: selectedJob.jobId,
        decision,
        note: note ?? undefined
      });
      startTransition(() => {
        setLastCancellationSummary(
          decision === "ACCEPT"
            ? `취소 합의가 완료되었어요. 환불 사유: ${responded.refundReasonNormalized ?? "거래 불발"}`
            : "취소 요청을 거절하고 거래를 계속 진행해요."
        );
      });
      await refreshActiveJobs();
    } catch (error) {
      props.onRuntimeError(error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleOpsReviewRequest() {
    if (!selectedJob?.counterpartUserId) {
      return;
    }

    const detail = window.prompt(
      "운영 검토에 전달할 내용을 적어주세요.",
      selectedJob.status === "PICKED_UP" ? "픽업 이후 진행에 문제가 있어 운영 검토가 필요해요." : "배송 진행 중 이슈가 있어 운영 검토가 필요해요."
    );
    if (!detail) {
      return;
    }

    setBusyLabel("운영 검토 요청 중");
    try {
      const report = await createJobReport({
        accessToken: props.accessToken,
        jobId: selectedJob.jobId,
        targetUserId: selectedJob.counterpartUserId,
        reportType: selectedJob.status === "DELIVERY_PROOF_SUBMITTED" ? "FALSE_COMPLETION" : "LOSS_OR_DAMAGE",
        detail
      });
      startTransition(() => {
        setLastCancellationSummary(`${formatDateTime(report.createdAt)} · 운영 검토 요청이 접수되었어요.`);
      });
      await refreshActiveJobs();
    } catch (error) {
      props.onRuntimeError(error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleDisputeEscalation() {
    if (!selectedJob) {
      return;
    }

    if (!window.confirm("완료 확인 대신 분쟁으로 전환할까요? 정산은 운영 검토가 끝날 때까지 보류돼요.")) {
      return;
    }

    setBusyLabel("분쟁 전환 중");
    try {
      const updated = await updateJobStatus({
        accessToken: props.accessToken,
        jobId: selectedJob.jobId,
        nextStatus: "DISPUTED"
      });
      startTransition(() => {
        setLastCancellationSummary(`의뢰 상태가 ${updated.status}로 전환되었어요. 운영팀이 결제와 증빙을 검토해요.`);
      });
      await refreshActiveJobs();
    } catch (error) {
      props.onRuntimeError(error);
    } finally {
      setBusyLabel(null);
    }
  }

  return (
    <section style={gridTwoColumnStyle}>
      <Panel title="진행 상태" subtitle="권한 설명 → 위치 기록/증빙 업로드 → 완료 등록 순서로만 진행합니다.">
        {loading ? <p style={{ margin: 0, color: "#57534e" }}>진행중 의뢰를 불러오는 중이에요...</p> : null}
        {!loading && activeJobs.length === 0 ? (
          <div style={featureCardStyle}>
            <strong>진행중 의뢰가 아직 없어요</strong>
            <p style={featureBodyStyle}>실제 위치 기록과 증빙 업로드는 매칭된 의뢰가 있을 때만 열립니다. 권한은 기능 직전에만 요청됩니다.</p>
          </div>
        ) : null}
        {activeJobs.length > 0 ? (
          <div style={{ display: "grid", gap: 12 }}>
            {activeJobs.map((item) => (
              <button
                key={item.jobId}
                style={{
                  ...cardStyle,
                  textAlign: "left",
                  borderColor: item.jobId === selectedJob?.jobId ? "#93c5fd" : butoTheme.colors.line,
                  background: item.jobId === selectedJob?.jobId ? "#f8fbff" : "#fbfcfe"
                }}
                onClick={() => setSelectedJobId(item.jobId)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div>
                    <strong style={{ color: butoTheme.colors.ink }}>{item.title}</strong>
                    <p style={{ margin: "8px 0 0", color: "#4e5968" }}>{item.pickupAddress} → {item.dropoffAddress}</p>
                    {item.cancellationRequest?.status === "PENDING_RUNNER_CONFIRMATION" ? (
                      <p style={{ margin: "8px 0 0", color: "#b45309", fontSize: 13, fontWeight: 700 }}>
                        합의 알림: 취소 응답 대기 중
                      </p>
                    ) : null}
                    {item.chatIdleAutoCancelAt ? (
                      <p style={{ margin: "6px 0 0", color: "#8b95a1", fontSize: 12 }}>
                        무응답 자동 파기 예정 {formatDateTime(item.chatIdleAutoCancelAt)}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge label={item.status} tone={item.riskLevel === "LOW" ? "brand" : "warning"} />
                </div>
              </button>
            ))}
          </div>
        ) : null}
        {selectedJob ? (
          <div style={{ ...featureCardStyle, marginTop: 16 }}>
            <strong>권한 사용 시점</strong>
            <p style={featureBodyStyle}>현재 위치 기록은 지오로케이션 권한 후에만, 픽업/전달 증빙은 업로드 세션 발급 후 카메라 또는 사진첩에서만 받습니다.</p>
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              <Field label="최근 위치 저장" value={selectedJob.lastLocationLoggedAt ? formatDateTime(selectedJob.lastLocationLoggedAt) : "아직 없음"} />
              <Field label="증빙 현황" value={`픽업 ${selectedJob.proofCounts.pickup}건 · 배송 ${selectedJob.proofCounts.delivery}건`} />
              <Field
                label="대화 무응답 자동 파기 시각"
                value={
                  selectedJob.chatIdleAutoCancelAt
                    ? formatDateTime(selectedJob.chatIdleAutoCancelAt)
                    : ["MATCHED", "RUNNER_EN_ROUTE", "RUNNER_ARRIVED"].includes(selectedJob.status)
                      ? "대화가 아직 없어요"
                      : "도착 알림 이후에는 자동 파기 미적용"
                }
              />
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <div style={cardStyle}>
                <strong style={{ color: butoTheme.colors.ink }}>거래 불발과 취소 원칙</strong>
                <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>
                  픽업 전에는 의뢰자가 합의 취소를 요청할 수 있고, 부르미가 수락하면 거래를 불발 처리해요. 개인 대화 20분 무응답 자동 파기는 부르미가 도착 알림을 보내기 전까지만 적용돼요.
                </p>
                <p style={{ margin: "8px 0 0", color: "#8b95a1", lineHeight: 1.6 }}>
                  부르미가 도착 알림을 보낸 뒤와 픽업 이후 이슈는 자동 취소하지 않고 분쟁 또는 운영 검토로 전환합니다. 환불은 거래 불발에만 정규화된 사유로 클라이언트 결제수단에 접수돼요.
                </p>
              </div>
              {selectedJob.cancellationRequest ? (
                <div style={{ ...cardStyle, borderColor: "#fde68a", background: "#fffbeb" }}>
                  <strong style={{ color: butoTheme.colors.ink }}>최근 취소 상태</strong>
                  <p style={{ margin: "8px 0 0", color: "#4e5968", lineHeight: 1.6 }}>
                    {selectedJob.cancellationRequest.status} · {selectedJob.cancellationRequest.reason}
                  </p>
                  <p style={{ margin: "8px 0 0", color: "#8b95a1", lineHeight: 1.6 }}>
                    요청 {formatDateTime(selectedJob.cancellationRequest.requestedAt)}
                    {selectedJob.cancellationRequest.respondedAt ? ` · 응답 ${formatDateTime(selectedJob.cancellationRequest.respondedAt)}` : ""}
                  </p>
                </div>
              ) : null}
              {canRequestMutualCancellation ? (
                <TDSButton size="large" color="dark" variant="weak" loading={busyLabel === "취소 요청 전송 중"} onClick={() => void handleRequestCancellation()}>
                  부르미에게 합의 취소 요청
                </TDSButton>
              ) : null}
              {canRespondMutualCancellation ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <TDSButton size="large" color="primary" variant="fill" loading={busyLabel === "취소 합의 처리 중"} onClick={() => void handleRespondCancellation("ACCEPT")}>
                    취소 요청 수락
                  </TDSButton>
                  <TDSButton size="large" color="dark" variant="weak" loading={busyLabel === "취소 거절 처리 중"} onClick={() => void handleRespondCancellation("REJECT")}>
                    취소 요청 거절
                  </TDSButton>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Panel>
      <Panel title="위치·증빙 실행" subtitle="Apps-in-Toss SDK 권한 API와 서버 업로드 세션을 실제로 사용합니다.">
        {agreementAlert ? (
          <div
            style={{
              ...cardStyle,
              marginBottom: 14,
              borderColor: agreementAlert.tone === "warning" ? "#fdba74" : agreementAlert.tone === "brand" ? "#93c5fd" : "#e5e8eb",
              background: agreementAlert.tone === "warning" ? "#fff7ed" : agreementAlert.tone === "brand" ? "#eff6ff" : "#ffffff"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div style={{ display: "grid", gap: 8 }}>
                <strong style={{ color: butoTheme.colors.ink }}>{agreementAlert.title}</strong>
                <p style={{ margin: 0, color: "#4e5968", lineHeight: 1.6 }}>{agreementAlert.body}</p>
              </div>
              <StatusBadge label="합의 알림" tone={agreementAlert.tone} />
            </div>
          </div>
        ) : null}
        {disputeAlert ? (
          <div
            style={{
              ...cardStyle,
              marginBottom: 14,
              borderColor: disputeAlert.tone === "warning" ? "#fca5a5" : "#93c5fd",
              background: disputeAlert.tone === "warning" ? "#fff1f2" : "#eff6ff"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div style={{ display: "grid", gap: 8 }}>
                <strong style={{ color: butoTheme.colors.ink }}>{disputeAlert.title}</strong>
                <p style={{ margin: 0, color: "#4e5968", lineHeight: 1.6 }}>{disputeAlert.body}</p>
              </div>
              <StatusBadge label="분쟁 안내" tone={disputeAlert.tone} />
            </div>
          </div>
        ) : null}
        <div style={cardStyle}>
          <p style={{ margin: 0, color: "#4e5968" }}>
            시스템 배너: 개인정보를 보내지 마세요. AI 안전 필터와 운영정책 검토가 불법 요청, 계좌 유도, 위협 표현을 감지할 수 있어요.
          </p>
        </div>
        <div style={{ ...cardStyle, display: "grid", gap: 10, marginTop: 14 }}>
          <strong style={{ color: butoTheme.colors.ink }}>긴급 신고 바로가기</strong>
          <p style={{ margin: 0, color: "#4e5968", lineHeight: 1.6 }}>
            현재는 심사/개발용 더미 연결을 사용해요. 실제 운영 전에는 신고 전화/문자 URL을 실서비스 값으로 교체해야 해요.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            <TDSButton size="large" color="dark" variant="weak" onClick={() => void openExternalUrl(emergencyCallUrl)}>
              긴급 전화 연결
            </TDSButton>
            <TDSButton size="large" color="dark" variant="weak" onClick={() => void openExternalUrl(emergencySmsUrl)}>
              긴급 문자 화면 열기
            </TDSButton>
          </div>
        </div>
        {!canUseSdk ? (
          <p style={{ margin: "14px 0 0", color: "#b45309", lineHeight: 1.6 }}>
            현재 환경에서는 Apps-in-Toss SDK를 감지하지 못했어요. 위치와 카메라 실행은 토스 앱 WebView에서만 동작합니다.
          </p>
        ) : null}
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <TDSButton size="large" color="dark" variant="weak" loading={busyLabel === "현재 위치 기록 중"} disabled={!selectedJob || !canUseSdk} onClick={() => void handleRecordLocation("manual")}>
            현재 위치 기록
          </TDSButton>
          <TDSButton size="large" color="dark" variant="weak" loading={busyLabel === "위치 추적 시작 중"} disabled={!selectedJob || !canUseSdk} onClick={() => void toggleLocationWatch()}>
            {watchingLocation ? "위치 추적 중지" : "위치 추적 시작"}
          </TDSButton>
          <TDSButton size="large" color="dark" variant="weak" loading={busyLabel === "픽업 사진 준비 중"} disabled={!selectedJob || !canUseSdk || !canUploadPickup} onClick={() => void handleCaptureProof("pickup")}>
            픽업 사진 촬영
          </TDSButton>
          <TDSButton size="large" color="dark" variant="weak" loading={busyLabel === "배송 사진 준비 중"} disabled={!selectedJob || !canUseSdk || !canUploadDelivery} onClick={() => void handleCaptureProof("delivery")}>
            배송 사진 촬영
          </TDSButton>
          <TDSButton size="large" color="dark" variant="weak" loading={busyLabel === "사진첩 불러오는 중"} disabled={!selectedJob || !canUseSdk} onClick={() => void handleLoadAlbumPhotos()}>
            사진첩 불러오기
          </TDSButton>
          <TDSButton size="large" color="dark" variant="weak" loading={busyLabel === "운영 검토 요청 중"} disabled={!selectedJob || !canRequestOpsReview} onClick={() => void handleOpsReviewRequest()}>
            픽업 이후 운영 검토 요청
          </TDSButton>
          <TDSButton size="large" color="primary" variant="fill" loading={busyLabel === "분쟁 전환 중"} disabled={!selectedJob || !canEscalateToDispute} onClick={() => void handleDisputeEscalation()}>
            완료 대신 분쟁 전환
          </TDSButton>
        </div>
        {busyLabel ? <p style={{ margin: "14px 0 0", color: "#8b95a1" }}>{busyLabel}</p> : null}
        {lastLocationSummary ? <p style={{ margin: "14px 0 0", color: "#0f172a", lineHeight: 1.6 }}>최근 위치 기록: {lastLocationSummary}</p> : null}
        {lastProofSummary ? <p style={{ margin: "10px 0 0", color: "#0f172a", lineHeight: 1.6 }}>최근 증빙 처리: {lastProofSummary}</p> : null}
        {lastCancellationSummary ? <p style={{ margin: "10px 0 0", color: "#0f172a", lineHeight: 1.6 }}>최근 취소 처리: {lastCancellationSummary}</p> : null}
        {albumPhotos.length > 0 ? (
          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            <strong style={{ color: butoTheme.colors.ink }}>사진첩에서 선택</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
              {albumPhotos.map((image) => (
                <div key={image.id} style={cardStyle}>
                  <img src={normalizeImageUri(image.dataUri)} alt="증빙 후보" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 16 }} />
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    <TDSButton size="small" color="dark" variant="weak" disabled={!selectedJob || !canUseSdk || !canUploadPickup} onClick={() => void handleUploadAlbumProof("pickup", image)}>
                      픽업 증빙
                    </TDSButton>
                    <TDSButton size="small" color="dark" variant="weak" disabled={!selectedJob || !canUseSdk || !canUploadDelivery} onClick={() => void handleUploadAlbumProof("delivery", image)}>
                      배송 증빙
                    </TDSButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <p style={{ margin: "14px 0 0", color: "#8b95a1", lineHeight: 1.6 }}>
          위치 추적은 {productConfig.locationLogIntervalMinutes}분 간격 정책으로 시작되고, 권한 거절 시에도 다른 탭과 계정 기능은 계속 사용할 수 있어요.
        </p>
      </Panel>
    </section>
  );
}

function Panel(props: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section style={panelStyle}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 24, color: butoTheme.colors.ink }}>{props.title}</h2>
        <p style={{ margin: "8px 0 0", color: "#57534e", lineHeight: 1.6 }}>{props.subtitle}</p>
      </div>
      {props.children}
    </section>
  );
}

function QuickAction(props: { title: string; body: string }) {
  return (
    <TDSListRow
      border="none"
      verticalPadding="large"
      horizontalPadding="small"
      style={cardStyle}
      contents={<TDSListRow.Texts type="2RowTypeA" top={props.title} bottom={props.body} />}
      right={<StatusBadge label="바로가기" tone="brand" />}
    />
  );
}

function Field(props: { label: string; value: string; multiline?: boolean }) {
  return (
    <label style={{ display: "grid", gap: 8 }}>
      <span style={{ fontWeight: 700, color: butoTheme.colors.ink }}>{props.label}</span>
      <div style={{ ...cardStyle, minHeight: props.multiline ? 120 : "auto" }}>{props.value}</div>
    </label>
  );
}

function ErrorBanner(props: { message: string }) {
  return (
    <div style={errorBannerStyle}>
      <strong>오류</strong>
      <span>{props.message}</span>
    </div>
  );
}

function getAgreementAlert(job: ActiveJobItem | null) {
  if (!job) {
    return null;
  }

  if (job.cancellationRequest?.status === "PENDING_RUNNER_CONFIRMATION") {
    return {
      tone: job.isRunnerView ? "warning" as const : "brand" as const,
      title: job.isRunnerView ? "의뢰자가 합의 취소 응답을 기다리고 있어요" : "부르미 응답을 기다리는 중이에요",
      body: job.isRunnerView
        ? "수락하면 픽업 전 거래를 불발 처리하고 결제를 클라이언트 결제수단으로 환불해요."
        : "부르미가 수락하면 거래를 취소하고 환불을 접수해요. 거절하면 거래는 계속 진행 상태로 유지돼요."
    };
  }

  if (job.cancellationRequest?.status === "REJECTED") {
    return {
      tone: "warning" as const,
      title: "최근 합의 취소 요청이 거절되었어요",
      body: "거래는 계속 진행 상태예요. 픽업 이후 이슈는 자동 취소하지 않고 운영 검토 또는 신고 흐름으로 이어져요."
    };
  }

  if (job.chatIdleAutoCancelAt && Date.parse(job.chatIdleAutoCancelAt) - Date.now() <= 5 * 60 * 1000) {
    return {
      tone: "warning" as const,
      title: "무응답 자동 파기 예정 시간이 가까워요",
      body: `개인 대화 응답이 없으면 ${formatDateTime(job.chatIdleAutoCancelAt)}에 도착 알림 전 거래가 자동 종료될 수 있어요.`
    };
  }

  return null;
}

function getDisputeAlert(job: ActiveJobItem | null) {
  if (!job) {
    return null;
  }

  if (job.status === "DISPUTED" || job.hasDispute) {
    return {
      tone: "warning" as const,
      title: "운영팀이 분쟁을 검토 중이에요",
      body: "정산과 상태 변경은 운영 검토가 끝날 때까지 보류돼요. 채팅, 증빙, 위치 기록을 임의 삭제하지 마세요."
    };
  }

  if (["PICKED_UP", "DELIVERING", "DELIVERY_PROOF_SUBMITTED"].includes(job.status)) {
    return {
      tone: "warning" as const,
      title: "픽업 이후 이슈는 자동 취소되지 않아요",
      body: "물건을 받은 뒤에는 자동 파기 대신 운영 검토나 분쟁 흐름으로 처리해요. 증빙과 신고를 남겨 주세요."
    };
  }

  if (job.status === "CLIENT_CONFIRM_PENDING") {
    return {
      tone: "brand" as const,
      title: "완료 확인 전 마지막 검토 단계예요",
      body: "문제가 있으면 완료 대신 분쟁으로 전환할 수 있어요. 분쟁 전환 시 정산은 보류되고 운영 검토가 시작돼요."
    };
  }

  return null;
}

async function ensureSdkPermission(input: {
  available: boolean;
  getPermission(): Promise<"notDetermined" | "denied" | "allowed">;
  openPermissionDialog(): Promise<"allowed" | "denied">;
  permissionName: string;
}) {
  if (!input.available) {
    throw new Error("Apps-in-Toss SDK를 불러오지 못했어요. 토스 앱 WebView 환경인지 확인해 주세요.");
  }

  const currentPermission = await input.getPermission();
  if (currentPermission === "allowed") {
    return;
  }

  const decidedPermission = await input.openPermissionDialog();
  if (decidedPermission !== "allowed") {
    throw new Error(`${input.permissionName} 권한이 없어서 이 기능을 진행할 수 없어요.`);
  }
}

async function uploadProofWorkflow(input: {
  accessToken: string;
  jobId: string;
  proofType: "pickup" | "delivery";
  source: "camera" | "album";
  image: { id: string; dataUri: string };
  onCompleted(summary: string): Promise<void>;
}) {
  const normalizedDataUri = normalizeImageUri(input.image.dataUri);
  const mimeTypeHint = normalizedDataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)?.[1];
  const started = await createProofUploadSession({
    accessToken: input.accessToken,
    jobId: input.jobId,
    proofType: input.proofType,
    source: input.source,
    mimeType: mimeTypeHint ?? "image/jpeg"
  });

  await uploadProofPhotoToSignedUrl({
    uploadMode: started.uploadMode,
    uploadMethod: started.uploadMethod,
    uploadUrl: started.uploadUrl,
    uploadHeaders: started.uploadHeaders,
    dataUri: normalizedDataUri,
    imageId: input.image.id,
    mimeTypeHint
  });

  const completed = await completeProofPhoto({
    accessToken: input.accessToken,
    jobId: input.jobId,
    proofType: input.proofType,
    uploadSessionId: started.uploadSessionId
  });

  await input.onCompleted(`${formatDateTime(completed.completedAt)} · ${formatProofType(input.proofType)} 등록 완료`);
}

function normalizeImageUri(value: string) {
  if (value.startsWith("data:image/")) {
    return value;
  }

  return `data:image/jpeg;base64,${value}`;
}

function toUserMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    return `${error.message} (${error.code})`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "알 수 없는 오류가 발생했어요.";
}

function toRestrictionState(error: unknown): RestrictionState | null {
  if (!(error instanceof ApiClientError)) {
    return null;
  }

  const details = error.details && typeof error.details === "object" ? (error.details as Record<string, unknown>) : undefined;
  const reasonMessage = typeof details?.reasonMessage === "string" ? details.reasonMessage : error.message;
  const reasonCode = typeof details?.reasonCode === "string" ? details.reasonCode : undefined;
  const scope = typeof details?.scope === "string" ? details.scope : undefined;
  const reviewStatus = toKnownReviewStatus(details?.reviewStatus);
  const actionId = typeof details?.actionId === "string" ? details.actionId : undefined;

  if (error.code === "ACCOUNT_RESTRICTED") {
    return {
      status: "RESTRICTED",
      title: "운영정책에 의해 계정 이용이 제한되었어요",
      body: reasonMessage,
      reasonCode,
      scope,
      reviewStatus,
      actionId,
      supportUrl: supportKakaoChannelUrl
    };
  }

  if (error.code === "ACCOUNT_SUSPENDED") {
    return {
      status: "SUSPENDED",
      title: "운영정책에 의해 계정 이용이 정지되었어요",
      body: reasonMessage,
      reasonCode,
      scope,
      reviewStatus,
      actionId,
      supportUrl: supportKakaoChannelUrl
    };
  }

  if (error.code === "ACCOUNT_APPEAL_PENDING") {
    return {
      status: "APPEAL_PENDING",
      title: "이의제기 검토가 진행 중이에요",
      body: reasonMessage,
      reasonCode,
      scope,
      reviewStatus,
      actionId,
      supportUrl: supportKakaoChannelUrl
    };
  }

  if (error.code === "ACCOUNT_PERMANENTLY_BANNED") {
    return {
      status: "PERMANENTLY_BANNED",
      title: "운영정책에 의해 계정이 영구 정지되었어요",
      body: reasonMessage,
      reasonCode,
      scope,
      reviewStatus,
      actionId,
      supportUrl: supportKakaoChannelUrl
    };
  }

  if (error.code === "ACCOUNT_WITHDRAWN") {
    return {
      status: "WITHDRAWN",
      title: "탈퇴 처리된 계정이에요",
      body: reasonMessage,
      reasonCode,
      actionId,
      supportUrl: supportKakaoChannelUrl
    };
  }

  return null;
}

function toKnownReviewStatus(value: unknown): AppealStatus | EnforcementReviewStatus | undefined {
  if (
    value === "AUTO_APPLIED" ||
    value === "UNDER_REVIEW" ||
    value === "APPEAL_PENDING" ||
    value === "MORE_INFO_REQUESTED" ||
    value === "UPHELD" ||
    value === "REINSTATED" ||
    value === "SUBMITTED" ||
    value === "APPROVED" ||
    value === "REJECTED"
  ) {
    return value;
  }

  return undefined;
}

function isOperationalUserStatus(status: SessionState["user"]["status"]) {
  return status === "ACTIVE" || status === "REINSTATED";
}

function toSessionRestriction(session: SessionState): RestrictionState {
  return {
    status:
      session.user.status === "RESTRICTED" ||
      session.user.status === "SUSPENDED" ||
      session.user.status === "APPEAL_PENDING" ||
      session.user.status === "PERMANENTLY_BANNED"
        ? session.user.status
        : "WITHDRAWN",
    title:
      session.user.status === "APPEAL_PENDING"
        ? "이의제기 검토가 진행 중이에요"
        : session.user.status === "WITHDRAWN"
          ? "탈퇴 처리된 계정이에요"
          : "운영정책에 의해 계정 이용이 제한되었어요",
    body: session.user.restriction?.reasonMessage ?? "운영정책 검토가 진행 중이에요.",
    reasonCode: session.user.restriction?.reasonCode,
    scope: session.user.restriction?.scope,
    reviewStatus: session.user.restriction?.reviewStatus,
    actionId: session.user.restriction?.actionId,
    supportUrl: supportKakaoChannelUrl
  };
}

function formatScope(scope: string) {
  if (scope === "ACCOUNT_FULL") {
    return "전체 기능 제한";
  }

  if (scope === "CHAT_ONLY") {
    return "채팅만 제한";
  }

  if (scope === "MATCHING_DISABLED") {
    return "매칭 제한";
  }

  if (scope === "PAYOUT_HOLD") {
    return "정산 보류";
  }

  return scope;
}

function formatReviewStatus(status: string) {
  if (status === "AUTO_APPLIED") {
    return "자동 적용";
  }

  if (status === "UNDER_REVIEW") {
    return "운영 검토 중";
  }

  if (status === "APPEAL_PENDING") {
    return "이의제기 접수";
  }

  if (status === "MORE_INFO_REQUESTED") {
    return "추가 자료 요청";
  }

  if (status === "UPHELD") {
    return "제재 유지";
  }

  if (status === "REINSTATED") {
    return "정지 해제";
  }

  return status;
}

function formatAppealStatus(status: AppealStatus) {
  if (status === "SUBMITTED") {
    return "접수";
  }

  if (status === "MORE_INFO_REQUESTED") {
    return "추가 자료 요청";
  }

  if (status === "APPROVED") {
    return "승인";
  }

  return "기각";
}

function formatProofType(proofType: "pickup" | "delivery") {
  return proofType === "pickup" ? "픽업 증빙" : "배송 증빙";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ko-KR");
}

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  padding: 20,
  background: "linear-gradient(180deg, #f7faff 0%, #fbfdff 55%, #f4f7fb 100%)",
  fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
};

const heroStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 20,
  alignItems: "stretch",
  marginBottom: 24,
  padding: 24,
  borderRadius: 28,
  background: "#ffffff",
  border: `1px solid ${butoTheme.colors.line}`,
  boxShadow: butoTheme.shadow
};

const tabStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  marginBottom: 24,
  padding: 6,
  borderRadius: 24,
  background: "#eef2f6",
  border: `1px solid ${butoTheme.colors.line}`
};

const tabButtonStyle: React.CSSProperties = {
  border: `1px solid ${butoTheme.colors.line}`,
  color: butoTheme.colors.ink,
  padding: "12px 16px",
  borderRadius: 999,
  fontWeight: 700
};

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

const rowCardStyle: React.CSSProperties = {
  ...cardStyle,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16
};

const primaryButtonStyle: React.CSSProperties = {
  border: "none",
  background: butoTheme.colors.brand,
  color: "#ffffff",
  fontWeight: 700,
  padding: "16px 20px",
  borderRadius: 999,
  boxShadow: "0 10px 24px rgba(49, 130, 246, 0.18)"
};

const secondaryButtonStyle: React.CSSProperties = {
  border: `1px solid ${butoTheme.colors.line}`,
  background: "#ffffff",
  color: butoTheme.colors.ink,
  fontWeight: 700,
  padding: "14px 18px",
  borderRadius: 999
};

const gridTwoColumnStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 20
};

const listResetStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: 12
};

const listStyle: React.CSSProperties = {
  margin: 0,
  color: "#4e5968",
  display: "grid",
  gap: 10,
  lineHeight: 1.6
};

const safetyScreenStyle: React.CSSProperties = {
  display: "grid",
  gap: 20,
  maxWidth: 920,
  margin: "0 auto"
};

const chatBubbleStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 20,
  background: "#f2f4f6",
  maxWidth: 360
};

const errorBannerStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  padding: "12px 16px",
  borderRadius: 18,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b"
};

const warningCardStyle: React.CSSProperties = {
  ...cardStyle,
  borderColor: "#fecaca",
  background: "#fff8f2"
};

const textareaStyle: React.CSSProperties = {
  minHeight: 120,
  padding: 16,
  borderRadius: 20,
  border: `1px solid ${butoTheme.colors.line}`,
  font: "inherit",
  resize: "vertical",
  background: "#ffffff"
};

const badgeRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap"
};

const complianceStripStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  color: "#4e5968",
  lineHeight: 1.6,
  fontSize: 14
};

const heroMetaStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  alignContent: "start"
};

const summaryTileStyle: React.CSSProperties = {
  ...cardStyle,
  background: "#f8fbff"
};

const summaryLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7684"
};

const summaryValueStyle: React.CSSProperties = {
  display: "block",
  marginTop: 8,
  fontSize: 22,
  color: butoTheme.colors.ink,
  letterSpacing: "-0.03em"
};

const summaryCopyStyle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "#4e5968",
  lineHeight: 1.6,
  fontSize: 14
};

const featureCardStyle: React.CSSProperties = {
  ...cardStyle,
  background: "#f9fbff"
};

const featureBodyStyle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "#4e5968",
  lineHeight: 1.7
};

const inlineNoticeStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 18,
  background: "#eef6ff",
  border: "1px solid #dbeafe",
  color: "#32506d",
  lineHeight: 1.6
};
