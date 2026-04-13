import { describe, expect, test } from "vitest";
import { CancelToken } from "../src/core/CancelToken";
import { CrossConnection } from "../src/core/CrossConnection";
import { nodeHttpAdapter } from "../src/adapters/http";
import { isCrossConnectionError } from "../src/index";
import { encryptJsonPayload } from "../src/security/Encryptor";
import { sanitizeHeaders } from "../src/security/Sanitizer";

describe("Sanitizer", () => {
  test("redacts sensitive header values", () => {
    const headers = {
      authorization: "Bearer secret",
      "x-trace-id": "123"
    };

    const safe = sanitizeHeaders(headers, ["authorization"]);
    expect(safe.authorization).toBe("[REDACTED]");
    expect(safe["x-trace-id"]).toBe("123");
  });
});

describe("Encryptor", () => {
  test("encrypts payload using AES-GCM", async () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    const encrypted = await encryptJsonPayload({ hello: "world" }, key);

    expect(encrypted.algorithm).toBe("aes-256-gcm");
    expect(typeof encrypted.iv).toBe("string");
    expect(typeof encrypted.tag).toBe("string");
    expect(typeof encrypted.ciphertext).toBe("string");
  });
});

describe("CrossConnection", () => {
  test("builds a GET request and applies interceptors", async () => {
    const client = new CrossConnection();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true, method: init?.method }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    let marker = "";
    client.interceptors.request.use((cfg) => {
      marker = "request";
      return cfg;
    });

    const res = await client.get<{ ok: boolean; method: string }>("https://example.com");
    expect(marker).toBe("request");
    expect(res.data.ok).toBe(true);
    expect(res.data.method).toBe("GET");

    globalThis.fetch = originalFetch;
  });

  test("blocks localhost by default", async () => {
    const client = new CrossConnection();

    await expect(client.get("http://localhost:3000/health")).rejects.toThrow(/Blocked localhost target/);
  });

  test("applies request and response transforms", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        return new Response(JSON.stringify({ body }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      const res = await client.post<{ body: string }>("https://example.com/transform", { hello: "world" }, {
        transformRequest: (data) => ({ wrapped: data }),
        transformResponse: (data) => {
          const parsed = data as { body: string };
          return { ...parsed, body: parsed.body.toUpperCase() };
        }
      });

      expect(res.data.body.includes("WRAPPED")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("retries failed response status then succeeds", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;
    let calls = 0;

    try {
      globalThis.fetch = async () => {
        calls += 1;
        if (calls < 2) {
          return new Response("temporary", { status: 503 });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      const res = await client.get<{ ok: boolean }>("https://example.com/retry", {
        retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 3 }
      });

      expect(calls).toBe(2);
      expect(res.data.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws CrossConnectionError when validateStatus fails", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;
    let calls = 0;

    try {
      globalThis.fetch = async () => {
        calls += 1;
        return new Response("missing", { status: 404 });
      };

      await expect(client.get("https://example.com/missing")).rejects.toMatchObject({
        isCrossConnectionError: true,
        status: 404,
        code: "ERR_BAD_RESPONSE"
      });
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("supports CancelToken cancellation", async () => {
    const client = new CrossConnection();
    const source = CancelToken.source();
    source.cancel("stopped");

    await expect(client.get("https://example.com", { cancelToken: source.token })).rejects.toMatchObject({
      name: "CancelError",
      code: "ERR_CANCELED"
    });
  });

  test("blocks host outside allowlist", async () => {
    const client = new CrossConnection({
      security: {
        allowHosts: ["api.example.com"]
      }
    });

    await expect(client.get("https://example.com/blocked")).rejects.toThrow(/outside allowlist/);
  });

  test("supports creating child instances", async () => {
    const parent = new CrossConnection({ headers: { "x-app": "parent" } });
    const child = parent.create({ headers: { "x-child": "1" } });
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        const sentHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(JSON.stringify({ sentHeaders }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      const res = await child.get<{ sentHeaders: Record<string, string> }>("https://example.com/headers");
      expect(res.data.sentHeaders["x-app"]).toBe("parent");
      expect(res.data.sentHeaders["x-child"]).toBe("1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not JSON stringify URLSearchParams", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        const params = init?.body as URLSearchParams;
        return new Response(JSON.stringify({
          isParams: params instanceof URLSearchParams,
          body: params.toString()
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      const payload = new URLSearchParams({ hello: "world" });
      const res = await client.post<{ isParams: boolean; body: string }>("https://example.com/params", payload);
      expect(res.data.isParams).toBe(true);
      expect(res.data.body).toContain("hello=world");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not JSON stringify FormData", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        const form = init?.body as FormData;
        return new Response(JSON.stringify({ isFormData: form instanceof FormData }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      const form = new FormData();
      form.append("hello", "world");
      const res = await client.post<{ isFormData: boolean }>("https://example.com/form", form);
      expect(res.data.isFormData).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("supports responseType text", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        return new Response("{\"hello\":\"world\"}", {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      const res = await client.get<string>("https://example.com/raw", { responseType: "text" });
      expect(typeof res.data).toBe("string");
      expect(res.data).toContain("hello");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("supports responseType arraybuffer", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        return new Response("buffer", {
          status: 200,
          headers: { "content-type": "text/plain" }
        });
      };

      const res = await client.get<ArrayBuffer>("https://example.com/ab", { responseType: "arraybuffer" });
      expect(res.data instanceof ArrayBuffer).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps timeout alias to ECONNABORTED", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          }, { once: true });
        });
      };

      await expect(
        client.get("https://example.com/timeout", {
          timeout: 5,
          retry: { retries: 0 }
        })
      ).rejects.toMatchObject({
        code: "ECONNABORTED",
        isCrossConnectionError: true
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("adds xsrf header in browser-like same-origin request", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;
    const originalWindow = (globalThis as unknown as { window?: unknown }).window;
    const originalDocument = (globalThis as unknown as { document?: unknown }).document;

    try {
      (globalThis as unknown as { window: unknown }).window = {
        location: {
          href: "https://example.com/path",
          origin: "https://example.com"
        }
      };
      (globalThis as unknown as { document: unknown }).document = {
        cookie: "XSRF-TOKEN=abc123"
      };

      globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        return new Response(JSON.stringify({ token: headers["X-XSRF-TOKEN"] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      const res = await client.get<{ token: string }>("https://example.com/data");
      expect(res.data.token).toBe("abc123");
    } finally {
      globalThis.fetch = originalFetch;

      const target = globalThis as unknown as { window?: unknown; document?: unknown };
      if (originalWindow === undefined) {
        delete target.window;
      } else {
        target.window = originalWindow;
      }

      if (originalDocument === undefined) {
        delete target.document;
      } else {
        target.document = originalDocument;
      }
    }
  });

  test("supports baseUrl alias for URL composition", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;
    let requested = "";

    try {
      globalThis.fetch = async (input: RequestInfo | URL) => {
        requested = String(input);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      await client.get<{ ok: boolean }>("/health", {
        baseUrl: "https://example.com"
      });

      expect(requested).toBe("https://example.com/health");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("exports isCrossConnectionError helper", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        return new Response("missing", { status: 404 });
      };

      try {
        await client.get("https://example.com/not-found");
      } catch (error) {
        expect(isCrossConnectionError(error)).toBe(true);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not retry POST on retriable status by default", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;
    let calls = 0;

    try {
      globalThis.fetch = async () => {
        calls += 1;
        return new Response("temporary", { status: 503 });
      };

      await expect(
        client.post("https://example.com/no-retry", { hello: "world" }, {
          retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 2 }
        })
      ).rejects.toMatchObject({
        isCrossConnectionError: true,
        status: 503
      });

      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("retries network errors only for allowed methods", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;
    let calls = 0;

    try {
      globalThis.fetch = async () => {
        calls += 1;
        if (calls < 2) {
          throw new Error("network down");
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      const res = await client.get<{ ok: boolean }>("https://example.com/network-retry", {
        retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 2, jitter: "none" }
      });

      expect(calls).toBe(2);
      expect(res.data.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("supports disabling network retries", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;
    let calls = 0;

    try {
      globalThis.fetch = async () => {
        calls += 1;
        throw new Error("network down");
      };

      await expect(
        client.get("https://example.com/no-network-retry", {
          retry: {
            retries: 3,
            baseDelayMs: 1,
            maxDelayMs: 2,
            retryOnNetworkError: false
          }
        })
      ).rejects.toMatchObject({
        isCrossConnectionError: true,
        code: "ERR_NETWORK"
      });

      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("emits telemetry hooks for retry and completion", async () => {
    const client = new CrossConnection();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    let retryEvent: { reason: string; delayMs: number } | undefined;
    let completionEvent: { success: boolean; attempts: number } | undefined;

    try {
      globalThis.fetch = async () => {
        calls += 1;
        if (calls < 2) {
          return new Response("temporary", { status: 503 });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      await client.get("https://example.com/telemetry", {
        retry: { retries: 2, baseDelayMs: 5, maxDelayMs: 5, jitter: "none" },
        telemetry: {
          onRetry: (event) => {
            retryEvent = { reason: event.reason, delayMs: event.delayMs };
          },
          onComplete: (event) => {
            completionEvent = { success: event.success, attempts: event.attempts };
          }
        }
      });

      expect(retryEvent).toMatchObject({ reason: "status", delayMs: 5 });
      expect(completionEvent).toMatchObject({ success: true, attempts: 2 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("opens circuit after threshold and blocks subsequent request", async () => {
    const client = new CrossConnection({
      circuitBreaker: {
        enabled: true,
        failureThreshold: 2,
        resetTimeoutMs: 100,
        scope: "host"
      }
    });

    const originalFetch = globalThis.fetch;
    let calls = 0;

    try {
      globalThis.fetch = async () => {
        calls += 1;
        return new Response("temporary", { status: 503 });
      };

      await expect(client.get("https://example.com/cb", { retry: { retries: 0 } })).rejects.toBeTruthy();
      await expect(client.get("https://example.com/cb", { retry: { retries: 0 } })).rejects.toBeTruthy();

      await expect(client.get("https://example.com/cb", { retry: { retries: 0 } })).rejects.toMatchObject({
        code: "ERR_CIRCUIT_OPEN"
      });

      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("allows recovery after circuit reset timeout", async () => {
    const client = new CrossConnection({
      circuitBreaker: {
        enabled: true,
        failureThreshold: 1,
        successThreshold: 1,
        resetTimeoutMs: 20,
        scope: "host"
      }
    });

    const originalFetch = globalThis.fetch;
    let calls = 0;

    try {
      globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("temporary", { status: 503 });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      await expect(client.get("https://example.com/cb-reset", { retry: { retries: 0 } })).rejects.toBeTruthy();
      await expect(client.get("https://example.com/cb-reset", { retry: { retries: 0 } })).rejects.toMatchObject({
        code: "ERR_CIRCUIT_OPEN"
      });

      await new Promise((resolve) => setTimeout(resolve, 25));

      const res = await client.get<{ ok: boolean }>("https://example.com/cb-reset", { retry: { retries: 0 } });
      expect(res.data.ok).toBe(true);
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Node adapter", () => {
  test("throws when pinning is configured for non-https url", async () => {
    await expect(
      nodeHttpAdapter({
        url: "http://example.com",
        method: "GET",
        security: { pinnedFingerprints: ["AA"] }
      })
    ).rejects.toThrow(/requires an HTTPS URL/);
  });
});
