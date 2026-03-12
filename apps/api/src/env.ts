const OPTIONAL_TOSS_ENV_KEYS = [
  "TOSS_LOGIN_TOKEN_URL",
  "TOSS_LOGIN_ME_URL",
  "TOSS_PARTNER_CLIENT_ID",
  "TOSS_PARTNER_CLIENT_SECRET",
  "TOSS_PARTNER_CERT_PATH",
  "TOSS_PARTNER_KEY_PATH",
  "TOSS_PARTNER_CA_PATH",
  "TOSS_CERT_TOKEN_URL",
  "TOSS_CERT_REQUEST_URL",
  "TOSS_CERT_STATUS_URL",
  "TOSS_CERT_RESULT_URL",
  "TOSS_CERT_CLIENT_ID",
  "TOSS_CERT_CLIENT_SECRET",
  "TOSS_CERT_REQUEST_URL_SCHEME",
  "TOSS_PAY_BASE_URL",
  "TOSS_PAY_CLIENT_ID",
  "TOSS_PAY_CLIENT_SECRET",
  "TOSS_PAY_MERCHANT_ID"
] as const;

const DEFAULT_AUTH_TOKEN_SECRET = "dev-buto-auth-secret";
const DEFAULT_INTERNAL_SYSTEM_KEY = "dev-buto-internal-key";

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsv(value: string | undefined, fallback: string[]) {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface ApiRuntimeConfig {
  strictTossAuthEnv: boolean;
  strictRuntimeEnv: boolean;
  strictDatabaseEnv: boolean;
  authTokenSecret: string;
  internalSystemKey: string;
  databaseUrl?: string;
  refreshTokenTtlDays: number;
  loginStateTtlMinutes: number;
  maxRefreshSessionsPerUser: number;
  outboxBatchSize: number;
  outboxLeaseSeconds: number;
  pushDispatchBatchSize: number;
  pushProvider: "log" | "webhook";
  pushWebhookUrl?: string;
  pushWebhookSecret?: string;
  proofStorageProvider: "local" | "s3";
  uploadPublicBaseUrl: string;
  proofPublicBaseUrl: string;
  proofS3Bucket?: string;
  proofS3Region?: string;
  proofS3Endpoint?: string;
  proofS3AccessKeyId?: string;
  proofS3SecretAccessKey?: string;
  proofS3SignedUrlTtlSeconds: number;
  tossUnlinkBasicUser: string;
  tossUnlinkBasicPassword: string;
  allowedOrigins: string[];
  tossPayBaseUrl: string;
  tossPayTestMode: boolean;
}

export function loadApiRuntimeConfig(env = process.env): ApiRuntimeConfig {
  return {
    strictTossAuthEnv: env.BUTO_STRICT_TOSS_AUTH_ENV === "true",
    strictRuntimeEnv: env.BUTO_STRICT_RUNTIME_ENV === "true",
    strictDatabaseEnv: env.BUTO_STRICT_DATABASE_ENV === "true",
    authTokenSecret: env.BUTO_AUTH_TOKEN_SECRET ?? DEFAULT_AUTH_TOKEN_SECRET,
    internalSystemKey: env.BUTO_INTERNAL_SYSTEM_KEY ?? DEFAULT_INTERNAL_SYSTEM_KEY,
    databaseUrl: env.BUTO_DATABASE_URL,
    refreshTokenTtlDays: parsePositiveNumber(env.BUTO_REFRESH_TOKEN_TTL_DAYS, 30),
    loginStateTtlMinutes: parsePositiveNumber(env.BUTO_LOGIN_STATE_TTL_MINUTES, 10),
    maxRefreshSessionsPerUser: parsePositiveNumber(env.BUTO_MAX_REFRESH_SESSIONS_PER_USER, 5),
    outboxBatchSize: parsePositiveNumber(env.BUTO_OUTBOX_BATCH_SIZE, 50),
    outboxLeaseSeconds: parsePositiveNumber(env.BUTO_OUTBOX_LEASE_SECONDS, 30),
    pushDispatchBatchSize: parsePositiveNumber(env.BUTO_PUSH_DISPATCH_BATCH_SIZE, 50),
    pushProvider: env.BUTO_PUSH_PROVIDER === "webhook" ? "webhook" : "log",
    pushWebhookUrl: env.BUTO_PUSH_WEBHOOK_URL,
    pushWebhookSecret: env.BUTO_PUSH_WEBHOOK_SECRET,
    proofStorageProvider: env.BUTO_PROOF_STORAGE_PROVIDER === "s3" ? "s3" : "local",
    uploadPublicBaseUrl: env.BUTO_UPLOAD_PUBLIC_BASE_URL ?? "http://localhost:4000",
    proofPublicBaseUrl: env.BUTO_PROOF_PUBLIC_BASE_URL ?? "https://cdn-placeholder.invalid/buto-proofs",
    proofS3Bucket: env.BUTO_PROOF_S3_BUCKET,
    proofS3Region: env.BUTO_PROOF_S3_REGION,
    proofS3Endpoint: env.BUTO_PROOF_S3_ENDPOINT,
    proofS3AccessKeyId: env.BUTO_PROOF_S3_ACCESS_KEY_ID,
    proofS3SecretAccessKey: env.BUTO_PROOF_S3_SECRET_ACCESS_KEY,
    proofS3SignedUrlTtlSeconds: parsePositiveNumber(env.BUTO_PROOF_S3_SIGNED_URL_TTL_SECONDS, 600),
    tossUnlinkBasicUser: env.TOSS_UNLINK_BASIC_USER ?? "unlink-placeholder-user",
    tossUnlinkBasicPassword: env.TOSS_UNLINK_BASIC_PASSWORD ?? "unlink-placeholder-password",
    allowedOrigins: parseCsv(env.BUTO_ALLOWED_ORIGINS, [
      "http://localhost:5173",
      "https://apps-in-toss-sandbox.invalid",
      "https://apps-in-toss-live.invalid"
    ]),
    tossPayBaseUrl: env.TOSS_PAY_BASE_URL ?? "https://pay-apps-in-toss-api.toss.im",
    tossPayTestMode: env.TOSS_PAY_TEST_MODE !== "false"
  };
}

export function validateTossAuthEnv(env = process.env) {
  const missing = OPTIONAL_TOSS_ENV_KEYS.filter((key) => !env[key]);
  return {
    ok: missing.length === 0,
    missing
  };
}

export function validateApiRuntimeConfig(config: ApiRuntimeConfig) {
  const issues: string[] = [];

  if (config.authTokenSecret === DEFAULT_AUTH_TOKEN_SECRET) {
    issues.push("BUTO_AUTH_TOKEN_SECRET");
  }

  if (config.internalSystemKey === DEFAULT_INTERNAL_SYSTEM_KEY) {
    issues.push("BUTO_INTERNAL_SYSTEM_KEY");
  }

  if (config.refreshTokenTtlDays <= 0) {
    issues.push("BUTO_REFRESH_TOKEN_TTL_DAYS");
  }

  if (config.loginStateTtlMinutes <= 0) {
    issues.push("BUTO_LOGIN_STATE_TTL_MINUTES");
  }

  if (config.maxRefreshSessionsPerUser <= 0) {
    issues.push("BUTO_MAX_REFRESH_SESSIONS_PER_USER");
  }

  if (config.outboxBatchSize <= 0) {
    issues.push("BUTO_OUTBOX_BATCH_SIZE");
  }

  if (config.outboxLeaseSeconds <= 0) {
    issues.push("BUTO_OUTBOX_LEASE_SECONDS");
  }

  if (config.pushDispatchBatchSize <= 0) {
    issues.push("BUTO_PUSH_DISPATCH_BATCH_SIZE");
  }

  if (config.pushProvider === "webhook" && !config.pushWebhookUrl) {
    issues.push("BUTO_PUSH_WEBHOOK_URL");
  }

  if (config.pushProvider === "webhook" && !config.pushWebhookSecret) {
    issues.push("BUTO_PUSH_WEBHOOK_SECRET");
  }

  if (config.proofStorageProvider === "local" && !config.uploadPublicBaseUrl) {
    issues.push("BUTO_UPLOAD_PUBLIC_BASE_URL");
  }

  if (!config.proofPublicBaseUrl) {
    issues.push("BUTO_PROOF_PUBLIC_BASE_URL");
  }

  if (config.proofStorageProvider === "s3") {
    if (!config.proofS3Bucket) {
      issues.push("BUTO_PROOF_S3_BUCKET");
    }
    if (!config.proofS3Region) {
      issues.push("BUTO_PROOF_S3_REGION");
    }
    if (!config.proofS3Endpoint) {
      issues.push("BUTO_PROOF_S3_ENDPOINT");
    }
    if (!config.proofS3AccessKeyId) {
      issues.push("BUTO_PROOF_S3_ACCESS_KEY_ID");
    }
    if (!config.proofS3SecretAccessKey) {
      issues.push("BUTO_PROOF_S3_SECRET_ACCESS_KEY");
    }
  }

  if (config.allowedOrigins.length === 0) {
    issues.push("BUTO_ALLOWED_ORIGINS");
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function validateDatabaseEnv(config: ApiRuntimeConfig) {
  const issues: string[] = [];

  if (config.strictDatabaseEnv && !config.databaseUrl) {
    issues.push("BUTO_DATABASE_URL");
  }

  return {
    ok: issues.length === 0,
    issues
  };
}
