export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiSuccess<T> {
  resultType: "SUCCESS";
  success: T;
}

export interface ApiFailure {
  resultType: "ERROR";
  error: ApiErrorPayload;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(success: T): ApiSuccess<T> {
  return { resultType: "SUCCESS", success };
}

export function fail(code: string, message: string, details?: Record<string, unknown>): ApiFailure {
  return { resultType: "ERROR", error: { code, message, details } };
}

