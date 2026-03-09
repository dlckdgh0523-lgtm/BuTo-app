import type { JobStatus, UserRole } from "./enums.ts";

type TransitionMap = Record<JobStatus, Partial<Record<UserRole, JobStatus[]>>>;

export const jobTransitions: TransitionMap = {
  DRAFT: {
    CLIENT: ["PAYMENT_PENDING", "CANCELLED"],
    SYSTEM: ["CANCELLED"]
  },
  PAYMENT_PENDING: {
    SYSTEM: ["OPEN", "CANCELLED"],
    CLIENT: ["CANCELLED"]
  },
  OPEN: {
    SYSTEM: ["OFFERING", "CANCELLED"],
    ADMIN: ["CANCELLED"]
  },
  OFFERING: {
    RUNNER: ["MATCHED"],
    CLIENT: ["CANCELLED"],
    SYSTEM: ["CANCELLED"]
  },
  MATCHED: {
    RUNNER: ["RUNNER_EN_ROUTE"],
    CLIENT: ["CANCELLED"],
    SYSTEM: ["CHAT_BLOCKED", "DISPUTED", "CANCELLED"],
    ADMIN: ["DISPUTED", "CANCELLED"]
  },
  RUNNER_EN_ROUTE: {
    RUNNER: ["RUNNER_ARRIVED"],
    SYSTEM: ["CHAT_BLOCKED", "DISPUTED"],
    ADMIN: ["DISPUTED", "CANCELLED"]
  },
  RUNNER_ARRIVED: {
    RUNNER: ["PICKED_UP"],
    SYSTEM: ["CHAT_BLOCKED", "DISPUTED"],
    ADMIN: ["DISPUTED", "CANCELLED"]
  },
  PICKED_UP: {
    RUNNER: ["DELIVERING"],
    SYSTEM: ["CHAT_BLOCKED", "DISPUTED"],
    ADMIN: ["DISPUTED"]
  },
  DELIVERING: {
    RUNNER: ["DELIVERY_PROOF_SUBMITTED"],
    SYSTEM: ["CHAT_BLOCKED", "DISPUTED"],
    ADMIN: ["DISPUTED"]
  },
  DELIVERY_PROOF_SUBMITTED: {
    SYSTEM: ["CLIENT_CONFIRM_PENDING", "DISPUTED"],
    CLIENT: ["COMPLETED"],
    ADMIN: ["DISPUTED"]
  },
  CLIENT_CONFIRM_PENDING: {
    CLIENT: ["COMPLETED", "DISPUTED"],
    SYSTEM: ["COMPLETED", "DISPUTED"],
    ADMIN: ["DISPUTED"]
  },
  CHAT_BLOCKED: {
    SYSTEM: ["DISPUTED"],
    ADMIN: ["DISPUTED"]
  },
  COMPLETED: {
    SYSTEM: ["FAILED_SETTLEMENT"],
    ADMIN: ["DISPUTED"]
  },
  DISPUTED: {
    ADMIN: ["COMPLETED", "CANCELLED", "FAILED_SETTLEMENT"]
  },
  CANCELLED: {},
  FAILED_SETTLEMENT: {
    ADMIN: ["COMPLETED"]
  }
};

export function getAllowedTransitions(current: JobStatus, actor: UserRole): JobStatus[] {
  return jobTransitions[current][actor] ?? [];
}

export function isValidJobTransition(current: JobStatus, next: JobStatus, actor: UserRole): boolean {
  return getAllowedTransitions(current, actor).includes(next);
}

