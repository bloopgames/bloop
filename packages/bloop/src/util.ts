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

export function unwrap<T>(
  value: T | null | undefined,
  message?: string,
): NonNullable<T> {
  assert(value != null, message ?? `Unwrap failed: value is ${value}`);
  return value;
}
