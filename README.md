# CrossConnection

[![npm version](https://img.shields.io/npm/v/cross-connection.svg)](https://www.npmjs.com/package/cross-connection)
[![npm downloads](https://img.shields.io/npm/dm/cross-connection.svg)](https://www.npmjs.com/package/cross-connection)
[![license](https://img.shields.io/npm/l/cross-connection.svg)](LICENSE)

A security-first Axios alternative for TypeScript, Node.js, browsers, and edge runtimes.

CrossConnection gives you an Axios-like developer experience with production-focused protections such as SSRF mitigation, retry backoff, telemetry hooks, request cancellation, and safe logging.

## Links

- npm package: https://www.npmjs.com/package/cross-connection
- GitHub repository: https://github.com/pratul03/cross-connection
- Live docs and demos: https://cross-connection-ui.vercel.app

## Why CrossConnection

- Axios-like API with stronger secure defaults
- Built-in retry policies with exponential backoff and jitter
- SSRF controls for private IPs, localhost, and host allowlists
- Interceptors, transforms, and telemetry hooks for observability
- AbortSignal and CancelToken cancellation support
- Header redaction helpers for safe logging

## Installation

```bash
npm install cross-connection
```

## Quick Start

```ts
import { createCrossConnection } from "cross-connection";

const client = createCrossConnection({
  baseURL: "https://api.example.com",
  timeout: 8000,
  retry: {
    retries: 2,
    baseDelayMs: 150,
    maxDelayMs: 2000,
  },
});

const response = await client.get<{ ok: boolean }>("/health");
console.log(response.data.ok);
```

## Secure Client Example

```ts
import { CrossConnection } from "cross-connection";

const client = new CrossConnection({
  security: {
    blockPrivateIPs: true,
    blockPrivateIPv6: true,
    blockLocalhost: true,
    allowHosts: ["api.example.com", "*.trusted.internal"],
    redactHeaders: ["authorization", "cookie", "x-api-key"],
  },
  retry: {
    retries: 3,
    baseDelayMs: 120,
    maxDelayMs: 1200,
  },
});
```

## Feature Highlights

- HTTP methods: get, post, put, patch, delete, head, options, request
- Interceptors: client.interceptors.request.use and client.interceptors.response.use
- Data transforms: transformRequest and transformResponse
- Security options: SSRF guards, DNS rebinding checks, host allowlists
- Reliability controls: retry policies, timeout handling, telemetry callbacks
- Crypto and transport hardening: AES-256-GCM request encryption and optional TLS fingerprint pinning in Node.js

## Documentation

- Full guide: [docs/USAGE.md](docs/USAGE.md)
- Axios comparison: [docs/AXIOS_COMPARISON.md](docs/AXIOS_COMPARISON.md)
- Interactive docs site: https://cross-connection-ui.vercel.app

## Development

```bash
npm install
npm run test
npm run build
```

## License

MIT
