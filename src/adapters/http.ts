import { IncomingHttpHeaders } from "http";
import { request as httpsRequest } from "https";
import { TLSSocket } from "tls";
import { matchesPinnedFingerprint } from "../security/CertificatePinner";
import { CrossConnectionRequestConfig } from "../types";

function isFormDataValue(data: unknown): data is FormData {
  return typeof FormData !== "undefined" && data instanceof FormData;
}

function isURLSearchParamsValue(data: unknown): data is URLSearchParams {
  return typeof URLSearchParams !== "undefined" && data instanceof URLSearchParams;
}

function isBlobValue(data: unknown): data is Blob {
  return typeof Blob !== "undefined" && data instanceof Blob;
}

function buildBody(config: CrossConnectionRequestConfig): BodyInit | undefined {
  const includeBody = config.method !== "GET" && config.method !== "HEAD";
  if (!includeBody || config.data === undefined) {
    return undefined;
  }

  if (
    typeof config.data === "string" ||
    config.data instanceof ArrayBuffer ||
    isFormDataValue(config.data) ||
    isURLSearchParamsValue(config.data) ||
    isBlobValue(config.data)
  ) {
    return config.data as BodyInit;
  }

  if (ArrayBuffer.isView(config.data)) {
    return config.data as unknown as BodyInit;
  }

  return JSON.stringify(config.data);
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function headersFromIncoming(rawHeaders: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (typeof value === "string") {
      result[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value.join(", ");
    }
  }

  return result;
}

function buildSignal(config: CrossConnectionRequestConfig): { signal?: AbortSignal; cleanup: () => void } {
  const cleanups: Array<() => void> = [];
  const controller = new AbortController();

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (config.signal) {
    if (config.signal.aborted) {
      abort();
    } else {
      const onAbort = () => abort();
      config.signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => config.signal?.removeEventListener("abort", onAbort));
    }
  }

  if (config.timeoutMs && config.timeoutMs > 0) {
    const timeoutId = setTimeout(abort, config.timeoutMs);
    cleanups.push(() => clearTimeout(timeoutId));
  }

  if (config.cancelToken) {
    const unsubscribe = config.cancelToken.subscribe(() => abort());
    cleanups.push(unsubscribe);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const fn of cleanups) {
        fn();
      }
    }
  };
}

function requestWithPinnedCertificate(
  config: CrossConnectionRequestConfig,
  body: BodyInit | undefined,
  signal: AbortSignal | undefined
): Promise<Response> {
  const url = new URL(config.url);
  if (url.protocol !== "https:") {
    throw new Error("TLS pinning requires an HTTPS URL.");
  }

  const pins = config.security?.pinnedFingerprints ?? [];

  return new Promise((resolve, reject) => {
    if (body !== undefined && isFormDataValue(body)) {
      reject(new Error("FormData is not supported in pinned TLS mode."));
      return;
    }

    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        method: config.method,
        path: `${url.pathname}${url.search}`,
        headers: config.headers
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const payload = Buffer.concat(chunks);
          resolve(
            new Response(payload, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? "",
              headers: headersFromIncoming(res.headers)
            })
          );
        });
      }
    );

    req.on("socket", (socket) => {
      const tlsSocket = socket as TLSSocket;
      tlsSocket.once("secureConnect", () => {
        const cert = tlsSocket.getPeerCertificate(true);
        const fingerprint = cert?.fingerprint256 ?? cert?.fingerprint;
        if (!fingerprint || !matchesPinnedFingerprint(fingerprint, pins)) {
          req.destroy(new Error("TLS pinning validation failed."));
        }
      });
    });

    const onAbort = () => {
      req.destroy(createAbortError("Request aborted"));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    req.on("error", (error) => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      reject(error);
    });

    req.on("close", () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    });

    (async () => {
      if (body === undefined) {
        req.end();
        return;
      }

      if (typeof body === "string") {
        req.write(body);
        req.end();
        return;
      }

      if (body instanceof ArrayBuffer) {
        req.write(Buffer.from(body));
        req.end();
        return;
      }

      if (ArrayBuffer.isView(body)) {
        req.write(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
        req.end();
        return;
      }

      if (isURLSearchParamsValue(body)) {
        req.write(body.toString());
        req.end();
        return;
      }

      if (isBlobValue(body)) {
        const data = await body.arrayBuffer();
        req.write(Buffer.from(data));
        req.end();
        return;
      }

      req.end();
    })().catch((error) => reject(error));
  });
}

export async function nodeHttpAdapter(config: CrossConnectionRequestConfig): Promise<Response> {
  const { signal, cleanup } = buildSignal(config);
  const body = buildBody(config);

  try {
    const requiresPinning = (config.security?.pinnedFingerprints?.length ?? 0) > 0;
    if (requiresPinning) {
      return await requestWithPinnedCertificate(config, body, signal);
    }

    return await fetch(config.url, {
      method: config.method,
      headers: config.headers,
      body,
      signal,
      credentials: config.withCredentials ? "include" : "same-origin",
      redirect: "manual"
    });
  } finally {
    cleanup();
  }
}
