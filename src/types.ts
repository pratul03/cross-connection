export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type HeadersMap = Record<string, string>;
export type ResponseType = "json" | "text" | "blob" | "arraybuffer";
export type RequestParamPrimitive = string | number | boolean;
export type RequestParamValue = RequestParamPrimitive | RequestParamPrimitive[] | null | undefined;
export type RetryJitterMode = "none" | "full";

export type TransformRequest = (data: unknown, config: CrossConnectionRequestConfig) => unknown;
export type TransformResponse = (data: unknown, response: CrossConnectionResponse) => unknown;

export interface CancelTokenLike {
  reason?: string;
  throwIfRequested(): void;
  subscribe(listener: (reason: string) => void): () => void;
}

export interface RetryConfig {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOnStatus: number[];
  retryOnNetworkError: boolean;
  retryMethods: HttpMethod[];
  jitter: RetryJitterMode;
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  scope: "global" | "host";
  failureThreshold: number;
  successThreshold: number;
  resetTimeoutMs: number;
}

export interface RetryTelemetryEvent {
  attempt: number;
  delayMs: number;
  reason: "status" | "network";
  method: HttpMethod;
  url: string;
  status?: number;
}

export interface RedirectTelemetryEvent {
  from: string;
  to: string;
  status: number;
  redirectCount: number;
}

export interface CompletionTelemetryEvent {
  method: HttpMethod;
  url: string;
  attempts: number;
  durationMs: number;
  status?: number;
  success: boolean;
  code?: string;
}

export interface TelemetryHooks {
  onRetry?: (event: RetryTelemetryEvent) => void;
  onRedirect?: (event: RedirectTelemetryEvent) => void;
  onComplete?: (event: CompletionTelemetryEvent) => void;
}

export interface SecurityConfig {
  blockPrivateIPs: boolean;
  blockPrivateIPv6: boolean;
  blockLocalhost: boolean;
  allowHosts: string[];
  pinnedFingerprints: string[];
  redactHeaders: string[];
  encryptRequestBody: boolean;
  encryptionKey?: string;
}

export interface CrossConnectionRequestConfig {
  url: string;
  method?: HttpMethod;
  baseURL?: string;
  baseUrl?: string;
  headers?: HeadersMap;
  params?: Record<string, RequestParamValue>;
  data?: unknown;
  timeout?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  withCredentials?: boolean;
  xsrfCookieName?: string;
  xsrfHeaderName?: string;
  responseType?: ResponseType;
  validateStatus?: (status: number) => boolean;
  transformRequest?: TransformRequest | TransformRequest[];
  transformResponse?: TransformResponse | TransformResponse[];
  retry?: Partial<RetryConfig>;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  security?: Partial<SecurityConfig>;
  signal?: AbortSignal;
  cancelToken?: CancelTokenLike;
  telemetry?: TelemetryHooks;
}

export interface CrossConnectionResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: HeadersMap;
  data: T;
  config: CrossConnectionRequestConfig;
}

export interface CrossConnectionError extends Error {
  status?: number;
  code?: string;
  config?: CrossConnectionRequestConfig;
  isCrossConnectionError?: boolean;
  isAxiosError?: boolean;
  response?: CrossConnectionResponse;
  toJSON?: () => Record<string, unknown>;
}
