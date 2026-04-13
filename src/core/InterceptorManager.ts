export interface InterceptorPair<T> {
  onFulfilled?: (value: T) => T | Promise<T>;
  onRejected?: (error: unknown) => unknown;
}

export class InterceptorManager<T> {
  private readonly handlers: Array<InterceptorPair<T> | null> = [];

  use(onFulfilled?: InterceptorPair<T>["onFulfilled"], onRejected?: InterceptorPair<T>["onRejected"]): number {
    this.handlers.push({ onFulfilled, onRejected });
    return this.handlers.length - 1;
  }

  eject(id: number): void {
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  }

  async runFulfilledChain(value: T): Promise<T> {
    let current = value;
    for (const handler of this.handlers) {
      if (!handler?.onFulfilled) {
        continue;
      }
      current = await handler.onFulfilled(current);
    }
    return current;
  }

  async runRejectedChain(error: unknown): Promise<void> {
    for (const handler of this.handlers) {
      if (handler?.onRejected) {
        handler.onRejected(error);
      }
    }
  }
}
