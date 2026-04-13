import { CrossConnection } from "./core/CrossConnection";
import { CrossConnectionError } from "./types";
export { CancelError, CancelToken } from "./core/CancelToken";
export { CrossConnection } from "./core/CrossConnection";

export * from "./types";
export * from "./security/Encryptor";
export * from "./security/Sanitizer";
export * from "./security/SsrfBlocker";
export * from "./security/CertificatePinner";

export function createCrossConnection(defaults?: ConstructorParameters<typeof CrossConnection>[0]): CrossConnection {
  return new CrossConnection(defaults);
}

export const crossConnection = createCrossConnection();

export function isCrossConnectionError(error: unknown): error is CrossConnectionError {
  return Boolean(error && typeof error === "object" && (error as CrossConnectionError).isCrossConnectionError);
}
