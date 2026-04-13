# CrossConnection vs Axios

This page compares CrossConnection and Axios based on real implementation behavior in this repository.

## Quick Summary

Use CrossConnection when you want security controls and resilience patterns built in by default.

Use Axios when your primary goal is ecosystem maturity and broad community plugin coverage.

## Feature Matrix

| Capability                                  | Axios                   | CrossConnection |
| ------------------------------------------- | ----------------------- | --------------- |
| Promise-based HTTP client                   | Yes                     | Yes             |
| Interceptors                                | Yes                     | Yes             |
| Cancel requests                             | Yes                     | Yes             |
| transformRequest / transformResponse        | Yes                     | Yes             |
| responseType handling                       | Yes                     | Yes             |
| Retry with backoff in core                  | No (usually via plugin) | Yes             |
| Retry policy by HTTP method + jitter        | No (plugin/custom)      | Yes             |
| Circuit breaker in core                     | No                      | Yes             |
| Telemetry hooks for retry/redirect/complete | No                      | Yes             |
| SSRF protection defaults                    | No                      | Yes             |
| Host allowlist checks                       | No                      | Yes             |
| Redirect target security re-validation      | No                      | Yes             |
| Sensitive header redaction utility          | No                      | Yes             |
| Request payload encryption (AES-256-GCM)    | No                      | Yes             |
| TLS fingerprint pinning in Node             | No (manual/custom)      | Yes             |

## Where CrossConnection Adds Value

1. Security by default

- Blocks localhost and private address targets unless explicitly allowed.
- Supports host allowlists and redirect target re-validation.

2. Reliability in core

- Built-in retries with idempotent-method awareness and jitter.
- Circuit breaker support to reduce cascading failures.

3. Better observability

- Retry, redirect, and completion telemetry hooks.

4. Operational safety

- Header redaction helper for log safety.
- Optional payload encryption and TLS pinning in Node.

## Where Axios Still Has Advantages

1. Ecosystem scale

- Larger community adoption and plugin surface.

2. Familiarity in many teams

- More existing examples across older stacks.

## Migration Notes

Most common API usage is intentionally similar.

### Basic Client

```ts
import axios from "axios";
// import { createCrossConnection } from "cross-connection";

// Axios
const ax = axios.create({ baseURL: "https://api.example.com" });

// CrossConnection
// const ax = createCrossConnection({ baseURL: "https://api.example.com" });
```

### Request Example

```ts
// Works the same style in both
const res = await ax.get("/users", {
  params: { page: 1 },
  timeout: 5000,
});
```

### Add Built-In Hardening (CrossConnection)

```ts
import { createCrossConnection } from "cross-connection";

const client = createCrossConnection({
  security: {
    blockPrivateIPs: true,
    blockPrivateIPv6: true,
    blockLocalhost: true,
    allowHosts: ["api.example.com"],
  },
  retry: {
    retries: 3,
    jitter: "full",
  },
  circuitBreaker: {
    enabled: true,
    scope: "host",
    failureThreshold: 5,
    successThreshold: 1,
    resetTimeoutMs: 30000,
  },
});
```

## Decision Guide

Choose CrossConnection if your service needs secure outbound defaults, resilience controls, and telemetry without stitching multiple packages together.

Choose Axios if your project prioritizes maximum ecosystem familiarity and you are already standardized on external plugins for retries/security policy.
