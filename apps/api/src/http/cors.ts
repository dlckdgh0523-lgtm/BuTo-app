export function buildCorsHeaders(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin || !allowedOrigins.includes(origin)) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
    "access-control-allow-credentials": "true"
  };
}

export function buildCorsPreflightHeaders(origin: string | undefined, allowedOrigins: string[]) {
  return {
    ...buildCorsHeaders(origin, allowedOrigins),
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,idempotency-key,x-actor-role,x-internal-key",
    "access-control-max-age": "86400"
  };
}
