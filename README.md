# CrossConnection

Security-first, Axios-style HTTP client for Node.js and browsers.

CrossConnection provides a familiar request API with hardened defaults:

- SSRF protections (private IP and localhost blocking)
- Optional host allowlist and DNS rebinding checks
- Retry with exponential backoff
- Request and response interceptors
- transformRequest and transformResponse hooks
- AES-256-GCM request payload encryption
- Optional TLS certificate fingerprint pinning in Node.js
- Header redaction utility for safe logging
- CancelToken and AbortSignal support

## Documentation

- Full guide: [docs/USAGE.md](docs/USAGE.md)
- Axios comparison: [docs/AXIOS_COMPARISON.md](docs/AXIOS_COMPARISON.md)

## Installation

```bash
npm install cross-connection
```

## Quick Start

```ts
import { createCrossConnection } from "cross-connection";

const client = createCrossConnection({
  baseURL: "https://api.example.com",
  retry: {
    retries: 2,
    baseDelayMs: 150,
    maxDelayMs: 2000,
  },
});

const res = await client.get<{ ok: boolean }>("/health");
console.log(res.data.ok);
```

## Security Configuration

```ts
import { CrossConnection } from "cross-connection";

const client = new CrossConnection({
  security: {
    blockPrivateIPs: true,
    blockPrivateIPv6: true,
    blockLocalhost: true,
    allowHosts: ["api.example.com", "*.trusted.internal"],
    pinnedFingerprints: ["AB:CD:EF:..."],
    encryptRequestBody: false,
    redactHeaders: ["authorization", "cookie", "x-api-key"],
  },
});
```

## API Overview

- Methods: get, post, put, patch, delete, head, options, request
- Interceptors:
  - client.interceptors.request.use(onFulfilled, onRejected)
  - client.interceptors.response.use(onFulfilled, onRejected)
- Cancelation:
  - AbortSignal via config.signal
  - CancelToken via CancelToken.source()
- Data transforms:
  - config.transformRequest
  - config.transformResponse

## Development

```bash
npm install
npm run test
npm run build
```

## Project Structure

```text
src/
	adapters/
	core/
	defaults/
	security/
	types.ts
tests/
```

## License

MIT
