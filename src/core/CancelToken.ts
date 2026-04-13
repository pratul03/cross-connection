import { CancelTokenLike } from "../types";

export class CancelError extends Error {
  code = "ERR_CANCELED";

  constructor(message = "Request canceled") {
    super(message);
    this.name = "CancelError";
  }
}

export class CancelToken implements CancelTokenLike {
  private listeners = new Set<(reason: string) => void>();
  reason?: string;

  static source(): { token: CancelToken; cancel: (reason?: string) => void } {
    const token = new CancelToken();
    return {
      token,
      cancel: (reason?: string) => token.cancel(reason)
    };
  }

  throwIfRequested(): void {
    if (this.reason) {
      throw new CancelError(this.reason);
    }
  }

  subscribe(listener: (reason: string) => void): () => void {
    this.listeners.add(listener);
    if (this.reason) {
      listener(this.reason);
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  cancel(reason = "Request canceled"): void {
    if (this.reason) {
      return;
    }

    this.reason = reason;
    for (const listener of this.listeners) {
      listener(reason);
    }
    this.listeners.clear();
  }
}
