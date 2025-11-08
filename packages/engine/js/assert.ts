export function assert(condition: any, message?: string): asserts condition {
  if (condition == null || condition === false) {
    throw new Error(message ?? "Assertion failed");
  }
}

export function unwrap<T>(
  value: T | null | undefined,
  message?: string,
): NonNullable<T> {
  assert(value != null, message ?? `Unwrap failed: value is ${value}`);
  return value;
}
