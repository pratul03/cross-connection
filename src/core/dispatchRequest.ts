import { xhrAdapter } from "../adapters/xhr";
import { defaultRetryConfig, defaultSecurityConfig, defaultValidateStatus } from "../defaults";
import { CancelError } from "./CancelToken";
import { encryptJsonPayload } from "../security/Encryptor";
import { resolveAndValidateHost } from "../security/SsrfBlocker";
import {
  CompletionTelemetryEvent,
  HeadersMap,
  HttpMethod,
  CrossConnectionError,
  CrossConnectionRequestConfig,
  CrossConnectionResponse,
  RequestParamValue,
  ResponseType
} from "../types";

type RequestAdapter = (config: CrossConnectionRequestConfig) => Promise<Response>;

function getNodeRequire(): ((id: string) => unknown) | undefined {
  try {
    return (0, eval)("require") as (id: string) => unknown;
  } catch {
    return undefined;
  }
}

async function resolveAdapter(): Promise<RequestAdapter> {
  if (typeof window !== "undefined") {
    return xhrAdapter;
  }

  const req = getNodeRequire();
  if (req) {
    const mod = req("../adapters/http") as { nodeHttpAdapter: RequestAdapter };
    return mod.nodeHttpAdapter;
  }

  const mod = await import("../adapters/http");
  return mod.nodeHttpAdapter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeHeaders(input?: HeadersMap): HeadersMap {
  return { ...(input ?? {}) };
}

function hasHeader(headers: HeadersMap | undefined, headerName: string): boolean {
  if (!headers) {
    return false;
  }

  const target = headerName.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function toArray<T>(value?: T | T[]): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isBrowserEnv(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isFormDataValue(data: unknown): boolean {
  return typeof FormData !== "undefined" && data instanceof FormData;
}

function isURLSearchParamsValue(data: unknown): boolean {
  return typeof URLSearchParams !== "undefined" && data instanceof URLSearchParams;
}

function isBlobValue(data: unknown): boolean {
  return typeof Blob !== "undefined" && data instanceof Blob;
}

function isBinaryValue(data: unknown): boolean {
  return data instanceof ArrayBuffer || ArrayBuffer.isView(data) || isBlobValue(data);
}

function isJsonObjectPayload(data: unknown): boolean {
  return typeof data === "object" && data !== null && !isFormDataValue(data) && !isURLSearchParamsValue(data) && !isBinaryValue(data);
}

function readCookie(name: string): string | undefined {
  if (!isBrowserEnv()) {
    return undefined;
  }

  const encodedName = encodeURIComponent(name);
  const cookies = document.cookie ? document.cookie.split(";") : [];

  for (const rawCookie of cookies) {
    const [rawKey, ...rest] = rawCookie.trim().split("=");
    if (rawKey !== encodedName) {
      continue;
    }

    return decodeURIComponent(rest.join("="));
  }

  return undefined;
}

function shouldAttachXsrfHeader(url: URL, withCredentials?: boolean): boolean {
  if (!isBrowserEnv()) {
    return false;
  }

  if (withCredentials) {
    return true;
  }

  return url.origin === window.location.origin;
}

function shouldIncludeBody(method?: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

function createCrossConnectionError(
  message: string,
  config: CrossConnectionRequestConfig,
  details: Partial<CrossConnectionError> = {}
): CrossConnectionError {
  const err = new Error(message) as CrossConnectionError;
  err.name = "CrossConnectionError";
  err.isCrossConnectionError = true;
  err.isAxiosError = true;
  err.config = config;
  if (details.code) {
    err.code = details.code;
  }
  if (details.status !== undefined) {
    err.status = details.status;
  }
  if (details.response) {
    err.response = details.response;
  }
  err.toJSON = () => ({
    name: err.name,
    message: err.message,
    code: err.code,
    status: err.status,
    isCrossConnectionError: err.isCrossConnectionError,
    isAxiosError: err.isAxiosError,
    config: err.config
  });
  return err;
}

function parseBody(rawBody: string, contentType: string | null): unknown {
  if (!rawBody) {
    return null;
  }

  if (contentType?.includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}

async function parseResponseData(
  response: Response,
  responseType: ResponseType | undefined,
  config: CrossConnectionRequestConfig,
  mappedResponse: CrossConnectionResponse
): Promise<unknown> {
  if (responseType === "text") {
    return response.text();
  }

  if (responseType === "arraybuffer") {
    return response.arrayBuffer();
  }

  if (responseType === "blob") {
    return response.blob();
  }

  const rawBody = await response.text();

  if (responseType === "json") {
    if (!rawBody) {
      return null;
    }

    try {
      return JSON.parse(rawBody);
    } catch {
      throw createCrossConnectionError("Failed to parse JSON response", config, {
        code: "ERR_BAD_RESPONSE",
        status: mappedResponse.status,
        response: mappedResponse
      });
    }
  }

  return parseBody(rawBody, response.headers.get("content-type"));
}

function appendParam(url: URL, key: string, value: RequestParamValue): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      url.searchParams.append(key, String(item));
    }
    return;
  }

  url.searchParams.append(key, String(value));
}

function buildUrl(config: CrossConnectionRequestConfig): URL {
  const base = config.baseURL ?? config.baseUrl;
  let url: URL;

  if (base) {
    url = new URL(config.url, base);
  } else {
    try {
      url = new URL(config.url);
    } catch (error) {
      if (isBrowserEnv()) {
        url = new URL(config.url, window.location.href);
      } else {
        throw error;
      }
    }
  }

  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      appendParam(url, key, value);
    }
  }

  return url;
}

function computeDelay(baseDelayMs: number, maxDelayMs: number, attempt: number): number {
  return Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
}

function computeRetryDelay(
  baseDelayMs: number,
  maxDelayMs: number,
  attempt: number,
  jitter: "none" | "full"
): number {
  const bounded = computeDelay(baseDelayMs, maxDelayMs, attempt);
  if (jitter === "none") {
    return bounded;
  }

  return Math.floor(Math.random() * (bounded + 1));
}

function canRetryMethod(method: HttpMethod, retryMethods: HttpMethod[]): boolean {
  return retryMethods.includes(method);
}

function emitCompletion(config: CrossConnectionRequestConfig, event: CompletionTelemetryEvent): void {
  config.telemetry?.onComplete?.(event);
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function dispatchRequest(config: CrossConnectionRequestConfig): Promise<CrossConnectionResponse> {
  const retry = { ...defaultRetryConfig, ...(config.retry ?? {}) };
  const security = { ...defaultSecurityConfig, ...(config.security ?? {}) };
  const startedAt = Date.now();

  const requestUrl = buildUrl(config);
  await resolveAndValidateHost(requestUrl.hostname, {
    blockPrivateIPs: security.blockPrivateIPs,
    blockPrivateIPv6: security.blockPrivateIPv6,
    blockLocalhost: security.blockLocalhost,
    allowHosts: security.allowHosts
  });

  const headers = mergeHeaders(config.headers);
  const finalConfig: CrossConnectionRequestConfig = {
    ...config,
    url: requestUrl.toString(),
    method: (config.method ?? "GET").toUpperCase() as CrossConnectionRequestConfig["method"],
    timeoutMs: config.timeoutMs ?? config.timeout,
    headers
  };

  if (shouldAttachXsrfHeader(requestUrl, finalConfig.withCredentials)) {
    const xsrfCookieName = finalConfig.xsrfCookieName ?? "XSRF-TOKEN";
    const xsrfHeaderName = finalConfig.xsrfHeaderName ?? "X-XSRF-TOKEN";
    const xsrfValue = readCookie(xsrfCookieName);

    if (xsrfValue) {
      finalConfig.headers = finalConfig.headers ?? {};
      if (!hasHeader(finalConfig.headers, xsrfHeaderName)) {
        finalConfig.headers[xsrfHeaderName] = xsrfValue;
      }
    }
  }

  const requestTransforms = toArray(finalConfig.transformRequest);
  for (const transform of requestTransforms) {
    finalConfig.data = transform(finalConfig.data, finalConfig);
  }

  if (finalConfig.cancelToken) {
    finalConfig.cancelToken.throwIfRequested();
  }

  if (finalConfig.data !== undefined && security.encryptRequestBody) {
    if (!security.encryptionKey) {
      throw new Error("security.encryptRequestBody is enabled, but no security.encryptionKey was provided.");
    }

    finalConfig.data = await encryptJsonPayload(finalConfig.data, security.encryptionKey);
    finalConfig.headers = {
      ...(finalConfig.headers ?? {}),
      "content-type": "application/json",
      "x-cross-connection-encrypted": "aes-256-gcm"
    };
  }

  if (
    finalConfig.data !== undefined &&
    shouldIncludeBody(finalConfig.method) &&
    isJsonObjectPayload(finalConfig.data)
  ) {
    finalConfig.headers = {
      ...(finalConfig.headers ?? {}),
      "content-type": finalConfig.headers?.["content-type"] ?? "application/json"
    };
  }

  const adapter = await resolveAdapter();
  const validateStatus = finalConfig.validateStatus ?? defaultValidateStatus;
  const maxRedirects = finalConfig.maxRedirects ?? 5;
  const initialUrl = finalConfig.url;
  const methodForRetry = (finalConfig.method ?? "GET").toUpperCase() as HttpMethod;
  const methodRetryAllowed = canRetryMethod(methodForRetry, retry.retryMethods);

  let lastError: unknown;

  retryLoop: for (let attempt = 0; attempt <= retry.retries; attempt += 1) {
    let currentUrl = initialUrl;
    let redirectCount = 0;

    try {
      finalConfig.cancelToken?.throwIfRequested();
      while (true) {
        finalConfig.url = currentUrl;
        const response = await adapter(finalConfig);

        const responseHeaders: HeadersMap = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        const mappedResponse: CrossConnectionResponse = {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          data: null,
          config: finalConfig
        };

        if (isRedirectStatus(mappedResponse.status) && mappedResponse.headers.location) {
          if (redirectCount >= maxRedirects) {
            throw createCrossConnectionError("Maximum redirects exceeded", finalConfig, {
              code: "ERR_FR_TOO_MANY_REDIRECTS",
              status: mappedResponse.status,
              response: mappedResponse
            });
          }

          const redirectedUrl = new URL(mappedResponse.headers.location, currentUrl);
          await resolveAndValidateHost(redirectedUrl.hostname, {
            blockPrivateIPs: security.blockPrivateIPs,
            blockPrivateIPv6: security.blockPrivateIPv6,
            blockLocalhost: security.blockLocalhost,
            allowHosts: security.allowHosts
          });

          currentUrl = redirectedUrl.toString();
          redirectCount += 1;
          finalConfig.telemetry?.onRedirect?.({
            from: finalConfig.url,
            to: currentUrl,
            status: mappedResponse.status,
            redirectCount
          });

          if (mappedResponse.status === 303 && finalConfig.method !== "GET" && finalConfig.method !== "HEAD") {
            finalConfig.method = "GET";
            finalConfig.data = undefined;
            if (finalConfig.headers) {
              for (const key of Object.keys(finalConfig.headers)) {
                if (key.toLowerCase() === "content-type") {
                  delete finalConfig.headers[key];
                }
              }
            }
          }

          continue;
        }

        if (methodRetryAllowed && retry.retryOnStatus.includes(mappedResponse.status) && attempt < retry.retries) {
          const delay = computeRetryDelay(retry.baseDelayMs, retry.maxDelayMs, attempt, retry.jitter);
          finalConfig.telemetry?.onRetry?.({
            attempt: attempt + 1,
            delayMs: delay,
            reason: "status",
            method: methodForRetry,
            url: finalConfig.url,
            status: mappedResponse.status
          });
          await sleep(delay);
          continue retryLoop;
        }

        mappedResponse.data = await parseResponseData(response, finalConfig.responseType, finalConfig, mappedResponse);

        const responseTransforms = toArray(finalConfig.transformResponse);
        for (const transform of responseTransforms) {
          mappedResponse.data = transform(mappedResponse.data, mappedResponse);
        }

        if (!validateStatus(mappedResponse.status)) {
          throw createCrossConnectionError(
            `Request failed with status code ${mappedResponse.status}`,
            finalConfig,
            {
              status: mappedResponse.status,
              response: mappedResponse,
              code: "ERR_BAD_RESPONSE"
            }
          );
        }

        emitCompletion(finalConfig, {
          method: methodForRetry,
          url: finalConfig.url,
          attempts: attempt + 1,
          durationMs: Date.now() - startedAt,
          status: mappedResponse.status,
          success: true
        });

        return mappedResponse;
      }
    } catch (error) {
      lastError = error;

      if (error instanceof CancelError) {
        throw error;
      }

      if (finalConfig.cancelToken?.reason) {
        throw new CancelError(finalConfig.cancelToken.reason);
      }

      if (error instanceof Error && error.name === "AbortError") {
        if ((finalConfig.timeoutMs ?? 0) > 0 && !finalConfig.signal?.aborted && !finalConfig.cancelToken?.reason) {
          throw createCrossConnectionError(`timeout of ${finalConfig.timeoutMs}ms exceeded`, finalConfig, {
            code: "ECONNABORTED"
          });
        }

        throw new CancelError("Request aborted");
      }

      const maybeCrossConnectionError = error as CrossConnectionError;
      if (maybeCrossConnectionError.isCrossConnectionError) {
        if (
          methodRetryAllowed &&
          maybeCrossConnectionError.status !== undefined &&
          retry.retryOnStatus.includes(maybeCrossConnectionError.status) &&
          attempt < retry.retries
        ) {
          const delay = computeRetryDelay(retry.baseDelayMs, retry.maxDelayMs, attempt, retry.jitter);
          finalConfig.telemetry?.onRetry?.({
            attempt: attempt + 1,
            delayMs: delay,
            reason: "status",
            method: methodForRetry,
            url: finalConfig.url,
            status: maybeCrossConnectionError.status
          });
          await sleep(delay);
          continue;
        }

        break;
      }

      if (!methodRetryAllowed || !retry.retryOnNetworkError || attempt >= retry.retries) {
        break;
      }

      const delay = computeRetryDelay(retry.baseDelayMs, retry.maxDelayMs, attempt, retry.jitter);
      finalConfig.telemetry?.onRetry?.({
        attempt: attempt + 1,
        delayMs: delay,
        reason: "network",
        method: methodForRetry,
        url: finalConfig.url
      });
      await sleep(delay);
    }
  }

  if (lastError instanceof Error) {
    if ((lastError as CrossConnectionError).isCrossConnectionError) {
      const typed = lastError as CrossConnectionError;
      emitCompletion(finalConfig, {
        method: methodForRetry,
        url: finalConfig.url,
        attempts: retry.retries + 1,
        durationMs: Date.now() - startedAt,
        status: typed.status,
        success: false,
        code: typed.code
      });
      throw lastError;
    }

    const wrapped = createCrossConnectionError(lastError.message, finalConfig, { code: "ERR_NETWORK" });
    emitCompletion(finalConfig, {
      method: methodForRetry,
      url: finalConfig.url,
      attempts: retry.retries + 1,
      durationMs: Date.now() - startedAt,
      success: false,
      code: wrapped.code
    });
    throw wrapped;
  }

  const fallback = createCrossConnectionError("Request failed after retries.", finalConfig, { code: "ERR_NETWORK" });
  emitCompletion(finalConfig, {
    method: methodForRetry,
    url: finalConfig.url,
    attempts: retry.retries + 1,
    durationMs: Date.now() - startedAt,
    success: false,
    code: fallback.code
  });
  throw fallback;
}
