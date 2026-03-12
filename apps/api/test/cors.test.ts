import test from "node:test";
import assert from "node:assert/strict";

import { buildCorsHeaders, buildCorsPreflightHeaders } from "../src/http/cors.ts";

test("buildCorsHeaders only reflects allowed origins", () => {
  const allowed = ["http://localhost:5173", "https://apps-in-toss-sandbox.invalid"];

  assert.deepEqual(buildCorsHeaders("https://apps-in-toss-sandbox.invalid", allowed), {
    "access-control-allow-origin": "https://apps-in-toss-sandbox.invalid",
    vary: "Origin",
    "access-control-allow-credentials": "true"
  });

  assert.deepEqual(buildCorsHeaders("https://evil.example", allowed), {});
  assert.deepEqual(buildCorsHeaders(undefined, allowed), {});
});

test("buildCorsPreflightHeaders keeps allowlist and expected request headers", () => {
  const headers = buildCorsPreflightHeaders("http://localhost:5173", ["http://localhost:5173"]);

  assert.equal(headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(headers["access-control-allow-methods"], "GET,POST,OPTIONS");
  assert.equal(headers["access-control-allow-headers"], "content-type,authorization,idempotency-key,x-actor-role,x-internal-key");
  assert.equal(headers["access-control-max-age"], "86400");
});
