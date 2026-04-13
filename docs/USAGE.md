# CrossConnection Usage Guide

## Install

```bash
npm install cross-connection
```

## Basic Usage

```ts
import { createCrossConnection } from "cross-connection";

const client = createCrossConnection({
  baseURL: "https://api.example.com",
});

const health = await client.get<{ ok: boolean }>("/health");
console.log(health.data.ok);
```

## HTTP Methods

```ts
await client.get("/users");
await client.post("/users", { name: "Ava" });
await client.put("/users/1", { name: "Ava M" });
await client.patch("/users/1", { role: "admin" });
await client.delete("/users/1");
await client.head("/users");
await client.options("/users");
```

## Request Config

```ts
await client.get("/search", {
  params: {
    q: "cross-connection",
    tags: ["http", "security"],
    page: 1,
  },
  headers: {
    "x-request-id": "abc-123",
  },
  timeout: 5000,
  responseType: "json",
});
```

## Interceptors

```ts
client.interceptors.request.use((config) => {
  config.headers = {
    ...(config.headers ?? {}),
    authorization: "Bearer token",
  };
  return config;
});

client.interceptors.response.use((response) => {
  return response;
});
```

## Retries

```ts
const api = createCrossConnection({
  retry: {
    retries: 3,
    baseDelayMs: 150,
    maxDelayMs: 2000,
    retryOnStatus: [408, 425, 429, 500, 502, 503, 504],
    retryOnNetworkError: true,
    retryMethods: ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"],
    jitter: "full",
  },
});
```

## Circuit Breaker

```ts
const api = createCrossConnection({
  circuitBreaker: {
    enabled: true,
    scope: "host",
    failureThreshold: 5,
    successThreshold: 1,
    resetTimeoutMs: 30000,
  },
});
```

## Telemetry Hooks

```ts
await client.get("/users", {
  telemetry: {
    onRetry: (event) => {
      console.log("retry", event.attempt, event.reason, event.delayMs);
    },
    onRedirect: (event) => {
      console.log("redirect", event.from, "->", event.to, event.status);
    },
    onComplete: (event) => {
      console.log("complete", event.success, event.durationMs);
    },
  },
});
```

## Security Controls

```ts
const secureClient = createCrossConnection({
  security: {
    blockPrivateIPs: true,
    blockPrivateIPv6: true,
    blockLocalhost: true,
    allowHosts: ["api.example.com", "*.trusted.internal"],
    redactHeaders: ["authorization", "cookie", "x-api-key"],
    encryptRequestBody: false,
    pinnedFingerprints: [],
  },
});
```

## Payload Encryption (AES-256-GCM)

```ts
const key = Buffer.alloc(32, 1).toString("base64");

const encryptedClient = createCrossConnection({
  security: {
    encryptRequestBody: true,
    encryptionKey: key,
  },
});

await encryptedClient.post("/sensitive", { card: "4111-1111-1111-1111" });
```

## TLS Fingerprint Pinning (Node.js)

```ts
const pinnedClient = createCrossConnection({
  security: {
    pinnedFingerprints: ["AA:BB:CC:DD:..."],
  },
});

await pinnedClient.get("https://api.example.com");
```

## Cancelation

```ts
import { CancelToken } from "cross-connection";

const source = CancelToken.source();
const promise = client.get("/slow", { cancelToken: source.token });
source.cancel("User canceled");
await promise;
```

## AbortSignal

```ts
const controller = new AbortController();
const promise = client.get("/slow", { signal: controller.signal });
controller.abort();
await promise;
```

## Response Transforms

```ts
await client.get("/users", {
  transformResponse: (data) => {
    return Array.isArray(data) ? data.slice(0, 10) : data;
  },
});
```

## Error Handling

```ts
import { isCrossConnectionError } from "cross-connection";

try {
  await client.get("/missing");
} catch (error) {
  if (isCrossConnectionError(error)) {
    console.log(error.code, error.status, error.message);
  }
}
```

## Development

```bash
npm install
npm run test
npm run build
```
