import { productConfig } from "../../../packages/config/src/index.ts";
import type { CommunityPost, ReviewRecord } from "../../../packages/contracts/src/index.ts";

import type { DemoUser, InMemoryStore } from "./store.ts";

const now = new Date().toISOString();

function seedUsers(): DemoUser[] {
  return [
    {
      userId: "client-1",
      ciHash: "ci_client_1",
      tossUserKey: "user-key-client-1",
      nickname: "서초의뢰자",
      adultVerified: true,
      status: "ACTIVE",
      roleFlags: ["CLIENT"],
      runnerVerified: false,
      businessVerified: false,
      payoutAccountVerified: false,
      riskScore: 10,
      activeJobs: 0,
      lastActiveAt: now
    },
    {
      userId: "runner-1",
      ciHash: "ci_runner_1",
      tossUserKey: "user-key-runner-1",
      nickname: "도보부르미",
      adultVerified: true,
      status: "ACTIVE",
      roleFlags: ["RUNNER"],
      safetyAcknowledgedAt: now,
      runnerVerified: true,
      businessVerified: false,
      payoutAccountVerified: true,
      riskScore: 5,
      activeJobs: 0,
      transportMode: "walk",
      lastActiveAt: now
    },
    {
      userId: "runner-2",
      ciHash: "ci_runner_2",
      tossUserKey: "user-key-runner-2",
      nickname: "1톤부르미",
      adultVerified: true,
      status: "ACTIVE",
      roleFlags: ["RUNNER"],
      safetyAcknowledgedAt: now,
      runnerVerified: true,
      businessVerified: true,
      payoutAccountVerified: true,
      riskScore: 6,
      activeJobs: 0,
      transportMode: "vehicle",
      vehicleTier: "1t_truck",
      lastActiveAt: now
    },
    {
      userId: "admin-1",
      ciHash: "ci_admin_1",
      tossUserKey: "user-key-admin-1",
      nickname: "리스크운영",
      adultVerified: true,
      status: "ACTIVE",
      roleFlags: ["ADMIN"],
      safetyAcknowledgedAt: now,
      runnerVerified: false,
      businessVerified: false,
      payoutAccountVerified: false,
      riskScore: 0,
      activeJobs: 0,
      lastActiveAt: now
    }
  ];
}

function seedReviews(): ReviewRecord[] {
  return [
    {
      reviewId: "review-1",
      jobId: "historic-job-1",
      authorUserId: "client-1",
      targetUserId: "runner-1",
      ratingValue: 5,
      body: "약속 시간에 맞게 정확하게 도착했어요.",
      createdAt: now
    }
  ];
}

function seedCommunityPosts(): CommunityPost[] {
  return [
    {
      postId: "post-1",
      authorUserId: "client-1",
      title: "첫 이용 후기",
      body: "위치 안내가 명확하고 사진 인증이 잘 보여서 안심됐어요.",
      createdAt: now
    }
  ];
}

export function createStore(): InMemoryStore {
  return {
    users: new Map(seedUsers().map((user) => [user.userId, user])),
    loginStates: new Map(),
    refreshSessions: new Map(),
    jobs: new Map(),
    chatRooms: new Map(),
    chatMessages: new Map(),
    faceAuthSessions: new Map(),
    payments: new Map(),
    reports: new Map(),
    emergencies: new Map(),
    proofUploadSessions: new Map(),
    jobCancellationRequests: new Map(),
    reviews: new Map(seedReviews().map((review) => [review.reviewId, review])),
    communityPosts: new Map(seedCommunityPosts().map((post) => [post.postId, post])),
    notifications: new Map(),
    pushSubscriptions: new Map(),
    pushDeliveryAttempts: new Map(),
    supportFallbacks: new Map(),
    userEnforcementActions: new Map(),
    enforcementEvidenceBundles: new Map(),
    userAppeals: new Map(),
    appealReviewActions: new Map(),
    workerHeartbeats: new Map(),
    locationLogs: [],
    proofPhotos: [],
    auditLogs: [],
    idempotency: new Map([
      [
        "config",
        {
          rulesVersion: productConfig.rulesVersion
        }
      ]
    ])
  };
}
