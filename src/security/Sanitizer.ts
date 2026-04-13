import { HeadersMap } from "../types";

export function sanitizeHeaders(headers: HeadersMap, sensitiveHeaders: string[]): HeadersMap {
  const lowered = new Set(sensitiveHeaders.map((h) => h.toLowerCase()));
  const sanitized: HeadersMap = {};

  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = lowered.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }

  return sanitized;
}
