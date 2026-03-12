import { createStore } from "../bootstrap.ts";
import { loadApiRuntimeConfig, validateDatabaseEnv } from "../env.ts";
import { AuthService } from "../modules/auth.service.ts";
import { CancellationService } from "../modules/cancellation.service.ts";
import { EnforcementService } from "../modules/enforcement.service.ts";
import { PaymentsService } from "../modules/payments.service.ts";
import { RealTossPayProvider } from "../modules/toss-pay-provider.ts";
import { PostgresPersistenceAdapter } from "../persistence.ts";
import { persistWorkerFailureNotifications } from "./worker-alerts.ts";

const runtimeConfig = loadApiRuntimeConfig();
const databaseValidation = validateDatabaseEnv(runtimeConfig);
if (!databaseValidation.ok || !runtimeConfig.databaseUrl) {
  throw new Error(`Missing BUTO database env: ${databaseValidation.issues.join(", ")}`);
}

const persistence = new PostgresPersistenceAdapter(runtimeConfig.databaseUrl);
const workerKey = "idle-timeout-worker";
const startedAt = new Date().toISOString();

const noopAuthProvider = {
  async exchangeLoginAuthorizationCode() {
    throw new Error("idle-timeout worker does not support login exchange");
  },
  async startOneTouchAuth() {
    throw new Error("idle-timeout worker does not support one-touch auth");
  },
  async completeOneTouchAuth() {
    throw new Error("idle-timeout worker does not support one-touch auth");
  }
};

try {
  await persistence.upsertWorkerHeartbeat({
    workerKey,
    lastStartedAt: startedAt,
    lastStatus: "RUNNING"
  });
  const store = createStore();
  await persistence.hydrate(store);

  const enforcement = new EnforcementService(store, persistence);
  const auth = new AuthService(store, noopAuthProvider, runtimeConfig, enforcement, persistence);
  const payments = new PaymentsService(store, auth, persistence, new RealTossPayProvider(), runtimeConfig);
  const cancellation = new CancellationService(store, persistence, payments);
  const result = await cancellation.sweepIdleTimeouts();

  if (result.resultType === "ERROR") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }

  console.log(
    JSON.stringify({
      level: "info",
      action: "IDLE_TIMEOUT_SWEEP_COMPLETED",
      scanned: result.success.scanned,
      cancelled: result.success.cancelled,
      processedAt: new Date().toISOString()
    })
  );
  await persistence.upsertWorkerHeartbeat({
    workerKey,
    lastStartedAt: startedAt,
    lastCompletedAt: new Date().toISOString(),
    lastStatus: "SUCCESS",
    lastSummary: result.success
  });
} catch (error) {
  await persistence.upsertWorkerHeartbeat({
    workerKey,
    lastStartedAt: startedAt,
    lastCompletedAt: new Date().toISOString(),
    lastStatus: "FAILED",
    lastSummary: {
      error: error instanceof Error ? error.message : "unknown"
    }
  });
  const store = createStore();
  await persistence.hydrate(store);
  await persistWorkerFailureNotifications({
    store,
    persistence,
    workerKey,
    startedAt,
    errorMessage: error instanceof Error ? error.message : "unknown"
  });
  throw error;
} finally {
  await persistence.close();
}
