import type { CreateJobRequest, RiskLevel } from "../../contracts/src/index.ts";

export interface RiskAssessment {
  level: RiskLevel;
  disposition: "ALLOW" | "WARN" | "REVIEW" | "BLOCK";
  reasons: string[];
}

const blockedKeywords = [
  "약",
  "처방전",
  "담배",
  "술",
  "현금",
  "통장",
  "카드",
  "otp",
  "대리 인증",
  "여권",
  "신분증"
];

const reviewKeywords = ["병원", "약국", "관공서", "법원", "경찰서"];

export function evaluateJobRisk(request: CreateJobRequest): RiskAssessment {
  const haystack = `${request.title} ${request.description}`.toLowerCase();
  const reasons: string[] = [];

  for (const keyword of blockedKeywords) {
    if (haystack.includes(keyword.toLowerCase())) {
      reasons.push(`blocked_keyword:${keyword}`);
    }
  }

  if (reasons.length > 0) {
    return { level: "HIGH", disposition: "BLOCK", reasons };
  }

  for (const keyword of reviewKeywords) {
    if (haystack.includes(keyword.toLowerCase())) {
      reasons.push(`review_keyword:${keyword}`);
    }
  }

  if (request.offerAmount >= 150000) {
    reasons.push("high_amount");
  }

  if (request.urgent) {
    reasons.push("urgent_request");
  }

  if (request.transportRequirement === "truck_1t_plus") {
    reasons.push("heavy_transport");
  }

  if (reasons.length === 0) {
    return { level: "LOW", disposition: "ALLOW", reasons: [] };
  }

  if (reasons.some((reason) => reason.startsWith("review_keyword")) || reasons.includes("high_amount")) {
    return { level: "HIGH", disposition: "REVIEW", reasons };
  }

  return { level: "MEDIUM", disposition: "WARN", reasons };
}

