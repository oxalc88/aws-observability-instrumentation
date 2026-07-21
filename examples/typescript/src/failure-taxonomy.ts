export const FAILURE_CLASSES = [
  "timeout",
  "cancelled",
  "dependency_failure",
  "validation_failure",
  "auth_failure",
  "rate_limited",
  "quota_exhausted",
  "internal_error",
  "unknown",
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

type ErrorConstructor = new (...args: never[]) => Error;
const registered = new Map<ErrorConstructor, FailureClass>();

export function registerFailure(
  errorClass: ErrorConstructor,
  failureClass: FailureClass,
): void {
  registered.set(errorClass, failureClass);
}

export function classifyFailure(error: unknown): FailureClass {
  if (error instanceof Error) {
    for (const [errorClass, failureClass] of registered) {
      if (error instanceof errorClass) return failureClass;
    }
    if (error.name === "AbortError") return "cancelled";
    if (error.name === "TimeoutError" || /timed? ?out/i.test(error.message)) {
      return "timeout";
    }
    if (error instanceof TypeError || error instanceof RangeError) {
      return "internal_error";
    }
  }
  return "unknown";
}
