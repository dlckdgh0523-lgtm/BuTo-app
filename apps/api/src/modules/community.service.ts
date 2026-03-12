import { fail, ok } from "../../../../packages/contracts/src/index.ts";
import { maskSensitiveText } from "../../../../packages/policy/src/index.ts";

import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore } from "../store.ts";
import { createId, nowIso } from "../utils.ts";

export class CommunityService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly persistence: PersistenceAdapter
  ) {}

  async createReview(userId: string, payload: { jobId: string; targetUserId: string; ratingValue: number; body: string }) {
    const job = this.store.jobs.get(payload.jobId);
    if (!job || job.status !== "COMPLETED") {
      return fail("REVIEW_NOT_ALLOWED", "완료된 거래에만 리뷰를 남길 수 있어요.");
    }

    const isParticipant = userId === job.clientUserId || userId === job.matchedRunnerUserId;
    if (!isParticipant) {
      return fail("REVIEW_NOT_AUTHORIZED", "거래에 참여한 사용자만 리뷰를 작성할 수 있어요.");
    }

    const counterpartUserId = userId === job.clientUserId ? job.matchedRunnerUserId : job.clientUserId;
    if (!counterpartUserId || payload.targetUserId !== counterpartUserId) {
      return fail("REVIEW_TARGET_INVALID", "거래 상대방에게만 리뷰를 작성할 수 있어요.");
    }

    const existing = [...this.store.reviews.values()].find(
      (review) =>
        review.jobId === payload.jobId &&
        review.authorUserId === userId &&
        review.targetUserId === payload.targetUserId
    );

    if (existing) {
      return fail("REVIEW_CONFLICT", "이미 작성한 리뷰예요.");
    }

    const review = {
      reviewId: createId("review"),
      jobId: payload.jobId,
      authorUserId: userId,
      targetUserId: payload.targetUserId,
      ratingValue: payload.ratingValue,
      body: maskSensitiveText(payload.body),
      createdAt: nowIso()
    };

    this.store.reviews.set(review.reviewId, review);
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertReview(review);
      });
    } catch (error) {
      this.store.reviews.delete(review.reviewId);
      throw error;
    }

    return ok(review);
  }

  listUserReviews(userId: string) {
    return ok({
      items: [...this.store.reviews.values()].filter((review) => review.targetUserId === userId)
    });
  }

  listPosts() {
    return ok({
      items: [...this.store.communityPosts.values()]
    });
  }

  async createPost(userId: string, payload: { title: string; body: string; imageUrl?: string }) {
    const post = {
      postId: createId("post"),
      authorUserId: userId,
      title: maskSensitiveText(payload.title),
      body: maskSensitiveText(payload.body),
      imageUrl: payload.imageUrl,
      createdAt: nowIso()
    };

    this.store.communityPosts.set(post.postId, post);
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertCommunityPost(post);
      });
    } catch (error) {
      this.store.communityPosts.delete(post.postId);
      throw error;
    }

    return ok(post);
  }
}
