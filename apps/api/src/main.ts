import http from "node:http";

import { createApp } from "./app.ts";

const app = createApp();

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

  const url = new URL(request.url, "http://localhost");
  const body = await readBody(request);
  const result = app.dispatch({
    method: request.method,
    path: url.pathname,
    query: url.searchParams,
    body,
    headers: new Headers(Object.entries(request.headers).flatMap(([key, value]) => (value ? [[key, Array.isArray(value) ? value.join(",") : value]] : [])))
  });

  const statusCode = result.resultType === "ERROR" ? mapErrorCode(result.error.code) : 200;
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(result, null, 2));
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => {
  console.log(`BUTO API listening on http://localhost:${port}`);
});

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
  if (code.includes("LOCK")) {
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

