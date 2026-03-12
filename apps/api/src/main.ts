import http from "node:http";

import { createRuntimeApp } from "./app.ts";
import { loadApiRuntimeConfig, validateApiRuntimeConfig, validateDatabaseEnv, validateTossAuthEnv } from "./env.ts";
import { buildCorsHeaders, buildCorsPreflightHeaders } from "./http/cors.ts";

const runtimeConfig = loadApiRuntimeConfig();
const envValidation = validateTossAuthEnv();
if (runtimeConfig.strictTossAuthEnv && !envValidation.ok) {
  throw new Error(`Missing Toss auth env: ${envValidation.missing.join(", ")}`);
}

const runtimeValidation = validateApiRuntimeConfig(runtimeConfig);
if (runtimeConfig.strictRuntimeEnv && !runtimeValidation.ok) {
  throw new Error(`Missing or insecure BUTO runtime env: ${runtimeValidation.issues.join(", ")}`);
}

const databaseValidation = validateDatabaseEnv(runtimeConfig);
if (!databaseValidation.ok) {
  throw new Error(`Missing BUTO database env: ${databaseValidation.issues.join(", ")}`);
}

const app = await createRuntimeApp({ runtimeConfig });

if (process.argv.includes("--routes")) {
  console.log(JSON.stringify(app.routes, null, 2));
  process.exit(0);
}

const server = http.createServer(async (request, response) => {
  if (!request.url || !request.method) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ resultType: "ERROR", error: { code: "BAD_REQUEST", message: "잘못된 요청이에요." } }));
    return;
  }

  const originHeaders = buildCorsHeaders(request.headers.origin, runtimeConfig.allowedOrigins);
  if (request.method === "OPTIONS") {
    response.writeHead(204, buildCorsPreflightHeaders(request.headers.origin, runtimeConfig.allowedOrigins));
    response.end();
    return;
  }

  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && url.pathname === "/me/notifications/stream") {
    await handleNotificationStream(request, response, url, originHeaders);
    return;
  }

  const body = await readBody(request);
  const result = await app.dispatch({
    method: request.method,
    path: url.pathname,
    query: url.searchParams,
    body,
    headers: new Headers(Object.entries(request.headers).flatMap(([key, value]) => (value ? [[key, Array.isArray(value) ? value.join(",") : value]] : [])))
  });

  const statusCode = result.resultType === "ERROR" ? mapErrorCode(result.error.code) : 200;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...originHeaders
  });
  response.end(JSON.stringify(result, null, 2));
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => {
  console.log(`BUTO API listening on http://localhost:${port}`);
});

async function handleNotificationStream(request: http.IncomingMessage, response: http.ServerResponse, url: URL, corsHeaders: Record<string, string>) {
  const headers = new Headers(
    Object.entries(request.headers).flatMap(([key, value]) => (value ? [[key, Array.isArray(value) ? value.join(",") : value]] : []))
  );
  const context = app.resolveContext(headers, "restricted-user");
  if (context.resultType === "ERROR") {
    const statusCode = mapErrorCode(context.error.code);
    response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(context, null, 2));
    return;
  }

  if (context.success.kind !== "user") {
    response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ resultType: "ERROR", error: { code: "FORBIDDEN", message: "사용자 인증이 필요해요." } }));
    return;
  }

  const userId = context.success.userId;
  const intervalMs = Math.max(1_000, Number(url.searchParams.get("intervalMs") ?? 5_000));
  let lastSignature = "";

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    ...corsHeaders
  });
  response.write(": connected\n\n");

  const writeSnapshot = async () => {
    const snapshot = await app.services.notifications.listUserNotifications(userId);
    if (snapshot.resultType === "ERROR") {
      response.write(`event: error\ndata: ${JSON.stringify(snapshot.error)}\n\n`);
      return;
    }

    const signature = JSON.stringify(
      snapshot.success.items.map((item) => [item.notificationId, item.readAt ?? null, item.createdAt])
    );
    if (signature === lastSignature) {
      return;
    }

    lastSignature = signature;
    response.write(`event: notifications\ndata: ${JSON.stringify(snapshot.success.items)}\n\n`);
  };

  await writeSnapshot();
  const timer = setInterval(() => {
    void writeSnapshot();
  }, intervalMs);

  const heartbeat = setInterval(() => {
    response.write(": keep-alive\n\n");
  }, 15_000);

  request.on("close", () => {
    clearInterval(timer);
    clearInterval(heartbeat);
    response.end();
  });
}

async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
}

function mapErrorCode(code: string) {
  if (code.includes("WITHDRAWN")) {
    return 410;
  }

  if (code.includes("PERMANENTLY_BANNED") || code.includes("SUSPENDED") || code.includes("FORBIDDEN")) {
    return 403;
  }

  if (code.includes("RESTRICTED") || code.includes("APPEAL_PENDING") || code.includes("LOCK")) {
    return 423;
  }

  if (code.includes("CONFLICT") || code.includes("INVALID_JOB_TRANSITION")) {
    return 409;
  }

  if (code.includes("IDEMPOTENCY") || code.includes("RATE_LIMIT")) {
    return 429;
  }

  return 400;
}
