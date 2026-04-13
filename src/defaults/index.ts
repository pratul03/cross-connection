import { CircuitBreakerConfig, RetryConfig, SecurityConfig } from "../types";

export function defaultValidateStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export const defaultRetryConfig: RetryConfig = {
  retries: 2,
  baseDelayMs: 150,
  maxDelayMs: 2000,
  retryOnStatus: [408, 425, 429, 500, 502, 503, 504],
  retryOnNetworkError: true,
  retryMethods: ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"],
  jitter: "full"
};

export const defaultSecurityConfig: SecurityConfig = {
  blockPrivateIPs: true,
  blockPrivateIPv6: true,
  blockLocalhost: true,
  allowHosts: [],
  pinnedFingerprints: [],
  redactHeaders: ["authorization", "proxy-authorization", "cookie", "x-api-key"],
  encryptRequestBody: false,
  encryptionKey: undefined
};

export const defaultCircuitBreakerConfig: CircuitBreakerConfig = {
  enabled: false,
  scope: "host",
  failureThreshold: 5,
  successThreshold: 1,
  resetTimeoutMs: 30000
};
