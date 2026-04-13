import { readFileSync } from "fs";
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "http";
import { request as httpsRequest, createServer as createHttpsServer } from "https";
import { AddressInfo } from "net";
import { TLSSocket } from "tls";
import { describe, expect, test } from "vitest";
import { CrossConnection } from "../src/core/CrossConnection";

function listenHttp(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ close: () => Promise<void>; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createHttpServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () => new Promise((done, fail) => server.close((err) => (err ? fail(err) : done())))
      });
    });
  });
}

function listenHttps(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ close: () => Promise<void>; port: number }> {
  return new Promise((resolve, reject) => {
    const key = readFileSync("tests/fixtures/test-key.pem", "utf8");
    const cert = readFileSync("tests/fixtures/test-cert.pem", "utf8");
    const server = createHttpsServer({ key, cert }, handler);

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () => new Promise((done, fail) => server.close((err) => (err ? fail(err) : done())))
      });
    });
  });
}

function fetchServerFingerprint(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let fingerprint = "";

    const req = httpsRequest(
      {
        hostname: "localhost",
        port,
        path: "/",
        method: "GET",
        rejectUnauthorized: false
      },
      (res) => {
        res.resume();
        res.once("end", () => resolve(fingerprint));
      }
    );

    req.once("socket", (socket) => {
      const tlsSocket = socket as TLSSocket;
      tlsSocket.once("secureConnect", () => {
        const cert = tlsSocket.getPeerCertificate();
        fingerprint = cert.fingerprint256 ?? "";
      });
    });

    req.once("error", reject);
    req.end();
  });
}

function insecureLocalSecurity() {
  return {
    blockLocalhost: false,
    blockPrivateIPs: false,
    blockPrivateIPv6: false
  };
}

describe("Phase 5 Integration", () => {
  test("follows redirects and emits redirect telemetry", async () => {
    const server = await listenHttp((req, res) => {
      if (req.url === "/start") {
        res.statusCode = 302;
        res.setHeader("location", "/final");
        res.end();
        return;
      }

      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });

    let redirectCount = 0;

    try {
      const client = new CrossConnection({
        security: insecureLocalSecurity()
      });

      const res = await client.get<{ ok: boolean }>(`http://localhost:${server.port}/start`, {
        retry: { retries: 0 },
        telemetry: {
          onRedirect: () => {
            redirectCount += 1;
          }
        }
      });

      expect(res.data.ok).toBe(true);
      expect(redirectCount).toBe(1);
    } finally {
      await server.close();
    }
  });

  test("stops when maxRedirects is exceeded", async () => {
    const server = await listenHttp((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", "/loop");
      res.end();
    });

    try {
      const client = new CrossConnection({
        security: insecureLocalSecurity()
      });

      await expect(
        client.get(`http://localhost:${server.port}/loop`, {
          retry: { retries: 0 },
          maxRedirects: 1
        })
      ).rejects.toMatchObject({
        code: "ERR_FR_TOO_MANY_REDIRECTS",
        isCrossConnectionError: true
      });
    } finally {
      await server.close();
    }
  });

  test("revalidates redirect target against allowlist", async () => {
    const server = await listenHttp((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", "https://example.com/");
      res.end();
    });

    try {
      const client = new CrossConnection({
        security: {
          ...insecureLocalSecurity(),
          allowHosts: ["localhost"]
        }
      });

      await expect(
        client.get(`http://localhost:${server.port}/redirect-out`, {
          retry: { retries: 0 }
        })
      ).rejects.toThrow(/outside allowlist/);
    } finally {
      await server.close();
    }
  });

  test("accepts pinned certificate when fingerprint matches", async () => {
    const previousTlsMode = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const server = await listenHttps((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const fingerprint = await fetchServerFingerprint(server.port);
      const client = new CrossConnection({
        security: {
          ...insecureLocalSecurity(),
          pinnedFingerprints: [fingerprint]
        }
      });

      const res = await client.get<{ ok: boolean }>(`https://localhost:${server.port}/`, {
        retry: { retries: 0 }
      });

      expect(res.data.ok).toBe(true);
    } finally {
      await server.close();
      if (previousTlsMode === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsMode;
      }
    }
  });

  test("rejects pinned certificate when fingerprint mismatches", async () => {
    const previousTlsMode = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const server = await listenHttps((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const client = new CrossConnection({
        security: {
          ...insecureLocalSecurity(),
          pinnedFingerprints: ["00:11:22:33"]
        }
      });

      await expect(
        client.get(`https://localhost:${server.port}/`, {
          retry: { retries: 0 }
        })
      ).rejects.toMatchObject({
        code: "ERR_NETWORK",
        isCrossConnectionError: true
      });
    } finally {
      await server.close();
      if (previousTlsMode === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsMode;
      }
    }
  });
});
