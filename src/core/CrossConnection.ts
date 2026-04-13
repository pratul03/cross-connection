import { defaultCircuitBreakerConfig, defaultSecurityConfig } from "../defaults";
import { sanitizeHeaders } from "../security/Sanitizer";
import { CrossConnectionError, CrossConnectionRequestConfig, CrossConnectionResponse } from "../types";
import { CircuitBreaker, resolveCircuitKey } from "./CircuitBreaker";
import { dispatchRequest } from "./dispatchRequest";
import { InterceptorManager } from "./InterceptorManager";

export class CrossConnection {
  private readonly defaults: Partial<CrossConnectionRequestConfig>;
  private readonly circuitBreaker = new CircuitBreaker();

  static create(defaults?: Partial<CrossConnectionRequestConfig>): CrossConnection {
    return new CrossConnection(defaults);
  }

  readonly interceptors = {
    request: new InterceptorManager<CrossConnectionRequestConfig>(),
    response: new InterceptorManager<CrossConnectionResponse>()
  };

  constructor(defaults?: Partial<CrossConnectionRequestConfig>) {
    this.defaults = defaults ?? {};
  }

  async request<T = unknown>(config: CrossConnectionRequestConfig): Promise<CrossConnectionResponse<T>> {
    const merged: CrossConnectionRequestConfig = {
      ...this.defaults,
      ...config,
      headers: {
        ...(this.defaults.headers ?? {}),
        ...(config.headers ?? {})
      },
      security: {
        ...(this.defaults.security ?? {}),
        ...(config.security ?? {})
      },
      retry: {
        ...(this.defaults.retry ?? {}),
        ...(config.retry ?? {})
      },
      circuitBreaker: {
        ...(this.defaults.circuitBreaker ?? {}),
        ...(config.circuitBreaker ?? {})
      }
    };

    let circuitRequest: CrossConnectionRequestConfig | undefined;

    const circuitPolicy = {
      ...defaultCircuitBreakerConfig,
      ...(merged.circuitBreaker ?? {})
    };

    try {
      const interceptedRequest = await this.interceptors.request.runFulfilledChain(merged);
      circuitRequest = interceptedRequest;

      if (circuitPolicy.enabled) {
        const circuitKey = resolveCircuitKey(interceptedRequest, circuitPolicy.scope);
        const allowed = this.circuitBreaker.isRequestAllowed(circuitKey, circuitPolicy);
        if (!allowed) {
          const remainingMs = this.circuitBreaker.getOpenRemainingMs(circuitKey, circuitPolicy);
          const error = new Error(`Circuit breaker is open. Retry after ${remainingMs}ms.`) as CrossConnectionError;
          error.name = "CrossConnectionError";
          error.code = "ERR_CIRCUIT_OPEN";
          error.isCrossConnectionError = true;
          error.isAxiosError = true;
          error.config = interceptedRequest;
          throw error;
        }
      }

      const response = await dispatchRequest(interceptedRequest);

      if (circuitPolicy.enabled) {
        const circuitKey = resolveCircuitKey(interceptedRequest, circuitPolicy.scope);
        this.circuitBreaker.recordSuccess(circuitKey, circuitPolicy);
      }

      const interceptedResponse = await this.interceptors.response.runFulfilledChain(response);
      return interceptedResponse as CrossConnectionResponse<T>;
    } catch (error) {
      if (circuitPolicy.enabled && circuitRequest && !(error as CrossConnectionError).code?.includes("CIRCUIT_OPEN")) {
        const isCanceled = error instanceof Error && error.name === "CancelError";
        if (!isCanceled) {
          const circuitKey = resolveCircuitKey(circuitRequest, circuitPolicy.scope);
          this.circuitBreaker.recordFailure(circuitKey, circuitPolicy);
        }
      }

      await this.interceptors.request.runRejectedChain(error);
      await this.interceptors.response.runRejectedChain(error);
      throw error;
    }
  }

  async call<T = unknown>(config: CrossConnectionRequestConfig): Promise<CrossConnectionResponse<T>> {
    return this.request<T>(config);
  }

  create(defaults?: Partial<CrossConnectionRequestConfig>): CrossConnection {
    return new CrossConnection({
      ...this.defaults,
      ...defaults,
      headers: {
        ...(this.defaults.headers ?? {}),
        ...(defaults?.headers ?? {})
      },
      security: {
        ...(this.defaults.security ?? {}),
        ...(defaults?.security ?? {})
      },
      retry: {
        ...(this.defaults.retry ?? {}),
        ...(defaults?.retry ?? {})
      }
    });
  }

  get<T = unknown>(url: string, config: Omit<CrossConnectionRequestConfig, "url" | "method"> = {}): Promise<CrossConnectionResponse<T>> {
    return this.request<T>({ ...config, url, method: "GET" });
  }

  post<T = unknown>(
    url: string,
    data?: unknown,
    config: Omit<CrossConnectionRequestConfig, "url" | "method" | "data"> = {}
  ): Promise<CrossConnectionResponse<T>> {
    return this.request<T>({ ...config, url, data, method: "POST" });
  }

  put<T = unknown>(
    url: string,
    data?: unknown,
    config: Omit<CrossConnectionRequestConfig, "url" | "method" | "data"> = {}
  ): Promise<CrossConnectionResponse<T>> {
    return this.request<T>({ ...config, url, data, method: "PUT" });
  }

  patch<T = unknown>(
    url: string,
    data?: unknown,
    config: Omit<CrossConnectionRequestConfig, "url" | "method" | "data"> = {}
  ): Promise<CrossConnectionResponse<T>> {
    return this.request<T>({ ...config, url, data, method: "PATCH" });
  }

  head<T = unknown>(
    url: string,
    config: Omit<CrossConnectionRequestConfig, "url" | "method"> = {}
  ): Promise<CrossConnectionResponse<T>> {
    return this.request<T>({ ...config, url, method: "HEAD" });
  }

  options<T = unknown>(
    url: string,
    config: Omit<CrossConnectionRequestConfig, "url" | "method"> = {}
  ): Promise<CrossConnectionResponse<T>> {
    return this.request<T>({ ...config, url, method: "OPTIONS" });
  }

  delete<T = unknown>(
    url: string,
    config: Omit<CrossConnectionRequestConfig, "url" | "method"> = {}
  ): Promise<CrossConnectionResponse<T>> {
    return this.request<T>({ ...config, url, method: "DELETE" });
  }

  safeHeadersForLogs(headers: Record<string, string>): Record<string, string> {
    const redactions = this.defaults.security?.redactHeaders ?? defaultSecurityConfig.redactHeaders;
    return sanitizeHeaders(headers, redactions);
  }
}
