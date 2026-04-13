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

export async function xhrAdapter(config: CrossConnectionRequestConfig): Promise<Response> {
  const includeBody = config.method !== "GET" && config.method !== "HEAD";
  const body = includeBody
    ? typeof config.data === "string" ||
      config.data instanceof ArrayBuffer ||
      ArrayBuffer.isView(config.data) ||
      isFormDataValue(config.data) ||
      isURLSearchParamsValue(config.data) ||
      isBlobValue(config.data)
      ? (config.data as BodyInit)
      : config.data === undefined
        ? undefined
        : JSON.stringify(config.data)
    : undefined;

  const { signal, cleanup } = buildSignal(config);

  try {
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
