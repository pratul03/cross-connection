import { HttpMethod, CrossConnectionRequestConfig } from "../types";

interface CircuitState {
  mode: "closed" | "open" | "half-open";
  failureCount: number;
  successCount: number;
  openedAt: number;
}

export interface CircuitPolicy {
  enabled: boolean;
  scope: "global" | "host";
  failureThreshold: number;
  successThreshold: number;
  resetTimeoutMs: number;
}

export class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  private getState(key: string): CircuitState {
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const state: CircuitState = {
      mode: "closed",
      failureCount: 0,
      successCount: 0,
      openedAt: 0
    };
    this.states.set(key, state);
    return state;
  }

  getOpenRemainingMs(key: string, policy: CircuitPolicy): number {
    const state = this.getState(key);
    if (state.mode !== "open") {
      return 0;
    }

    const elapsed = Date.now() - state.openedAt;
    return Math.max(0, policy.resetTimeoutMs - elapsed);
  }

  isRequestAllowed(key: string, policy: CircuitPolicy): boolean {
    if (!policy.enabled) {
      return true;
    }

    const state = this.getState(key);
    if (state.mode === "closed") {
      return true;
    }

    if (state.mode === "open") {
      const elapsed = Date.now() - state.openedAt;
      if (elapsed < policy.resetTimeoutMs) {
        return false;
      }

      state.mode = "half-open";
      state.successCount = 0;
      return true;
    }

    return true;
  }

  recordSuccess(key: string, policy: CircuitPolicy): void {
    if (!policy.enabled) {
      return;
    }

    const state = this.getState(key);
    if (state.mode === "half-open") {
      state.successCount += 1;
      if (state.successCount >= policy.successThreshold) {
        state.mode = "closed";
        state.failureCount = 0;
        state.successCount = 0;
        state.openedAt = 0;
      }
      return;
    }

    state.failureCount = 0;
  }

  recordFailure(key: string, policy: CircuitPolicy): void {
    if (!policy.enabled) {
      return;
    }

    const state = this.getState(key);
    if (state.mode === "half-open") {
      state.mode = "open";
      state.openedAt = Date.now();
      state.failureCount = policy.failureThreshold;
      state.successCount = 0;
      return;
    }

    state.failureCount += 1;
    if (state.failureCount >= policy.failureThreshold) {
      state.mode = "open";
      state.openedAt = Date.now();
      state.successCount = 0;
    }
  }
}

function tryResolveUrl(config: CrossConnectionRequestConfig): URL | undefined {
  const base = config.baseURL ?? config.baseUrl;
  if (base) {
    return new URL(config.url, base);
  }

  try {
    return new URL(config.url);
  } catch {
    return undefined;
  }
}

export function resolveCircuitKey(config: CrossConnectionRequestConfig, scope: CircuitPolicy["scope"]): string {
  if (scope === "global") {
    return "global";
  }

  const parsed = tryResolveUrl(config);
  if (!parsed) {
    return "global";
  }

  return parsed.host;
}

export function methodForCircuit(config: CrossConnectionRequestConfig): HttpMethod {
  return (config.method ?? "GET").toUpperCase() as HttpMethod;
}
