export function toHexString(dataView: DataView, length?: number): string {
  length ??= dataView.byteLength;
  let hexString = "";
  for (let i = 0; i < length; i++) {
    const byte = dataView.getUint8(i);
    hexString += `${byte.toString(16).padStart(2, "0")} `;
  }
  return hexString.trim();
}

export function assert(condition: any, message?: string): asserts condition {
  if (condition == null || condition === false) {
    throw new Error(message ?? "Assertion failed");
  }
}

const backpressureLogs = new Map<string, number>();

/**
 * Log message a single time only
 *
 * @example
 *
 * Util.logOnce("Frame rendered", 12345);
 */
export function logOnce(...args: any[]) {
  const key = args.map((a) => String(a)).join(" ");
  if (!backpressureLogs.has(key)) {
    console.log(...args);
    backpressureLogs.set(key, 1);
  }
}

/**
 * Log messages at most once per second
 *
 * @example
 *
 * Util.logPerSecond(performance.now(), "Frame rendered", 12345);
 */
export function logPerSecond(now: number, ...args: any[]) {
  logEvery(now, 1000, ...args);
}

/**
 * Log messages every N milliseconds
 *
 * @example
 *
 * Util.logEvery(20, "Frame rendered", 12345);
 */
export function logEvery(now: number, interval: number = 10, ...args: any[]) {
  const key = args.map((a) => String(a)).join(" ");
  const lastLogged = backpressureLogs.get(key) ?? -Infinity;
  if (now - lastLogged >= interval) {
    console.log(...args);
    backpressureLogs.set(key, now);
  }
}

export function unwrap<T>(
  value: T | null | undefined,
  message?: string,
): NonNullable<T> {
  assert(value != null, message ?? `Unwrap failed: value is ${value}`);
  return value;
}
