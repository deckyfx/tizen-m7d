/**
 * Domain errors for m7d, using the factory pattern (`X.throw()` / `X.create()`),
 * plus a Go-style helper for awaiting promises without try/catch.
 */

/** Reasons an sdb operation can fail. */
export type SdbFailure =
  "busy" | "closed" | "timeout" | "rejected" | "protocol";

/** sdb connection or command failure. */
export class SdbError extends Error {
  reason: SdbFailure = "protocol";

  constructor(message?: string) {
    super(message);
    this.name = "SdbError";
  }

  /** Creates an SdbError with a reason, without throwing. */
  static create(message: string, reason: SdbFailure): SdbError {
    const error = new SdbError(message);
    error.reason = reason;
    return error;
  }

  /** Creates and throws an SdbError. */
  static throw(message: string, reason: SdbFailure): never {
    throw SdbError.create(message, reason);
  }
}

/** The TV did not answer on the network (off, rebooting, or wrong IP). */
export class TvUnreachableError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "TvUnreachableError";
  }

  /** Creates a TvUnreachableError without throwing. */
  static create(message: string): TvUnreachableError {
    return new TvUnreachableError(message);
  }

  /** Creates and throws a TvUnreachableError. */
  static throw(message: string): never {
    throw new TvUnreachableError(message);
  }
}

/** The TV's remote-control WebSocket refused or failed a request. */
export class TvRemoteError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "TvRemoteError";
  }

  /** Creates a TvRemoteError without throwing. */
  static create(message: string): TvRemoteError {
    return new TvRemoteError(message);
  }

  /** Creates and throws a TvRemoteError. */
  static throw(message: string): never {
    throw new TvRemoteError(message);
  }
}

/** A requested app id is not installed on the TV. */
export class AppNotFoundError extends Error {
  appId = "";

  constructor(message?: string) {
    super(message);
    this.name = "AppNotFoundError";
  }

  /** Creates and throws an AppNotFoundError for `appId`. */
  static throw(appId: string): never {
    const error = new AppNotFoundError(`App not installed: ${appId}`);
    error.appId = appId;
    throw error;
  }
}

/** Constructor type accepted by {@link catchErrorTyped}. */
type ErrorClass = new (message?: string) => Error;

/**
 * Awaits `promise` and returns `[undefined, value]` or `[error]` for the listed error classes.
 * Any other error is re-thrown (fail fast on programming bugs).
 */
export function catchErrorTyped<T, E extends ErrorClass>(
  promise: Promise<T>,
  errorsToCatch: E[],
): Promise<[undefined, T] | [InstanceType<E>]> {
  return promise
    .then((data): [undefined, T] => [undefined, data])
    .catch((error: Error) => {
      if (errorsToCatch.some((errorClass) => error instanceof errorClass)) {
        return [error as InstanceType<E>];
      }
      throw error;
    });
}

/** An apps2samsung-cli command failed (its own error message, exit code and details). */
export class A2sError extends Error {
  exitCode = 1;
  details: Record<string, unknown> | undefined;

  constructor(message?: string) {
    super(message);
    this.name = "A2sError";
  }

  /** Creates and throws an A2sError. */
  static throw(message: string, exitCode: number, details?: Record<string, unknown>): never {
    const error = new A2sError(message);
    error.exitCode = exitCode;
    error.details = details;
    throw error;
  }
}

/** A request was refused by m7d's own policy (e.g. root apps). */
export class PolicyError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "PolicyError";
  }

  /** Creates and throws a PolicyError. */
  static throw(message: string): never {
    throw new PolicyError(message);
  }
}

/**
 * The YouTube shim's setup service on the TV failed, or never reported back to m7d
 * (not started, or it cannot reach the homelab).
 */
export class YtSetupError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "YtSetupError";
  }

  /** Creates and throws a YtSetupError. */
  static throw(message: string): never {
    throw new YtSetupError(message);
  }
}
