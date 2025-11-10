export function toHexString(dataView: DataView, length?: number): string {
  length ??= dataView.byteLength;
  let hexString = "";
  for (let i = 0; i < length; i++) {
    const byte = dataView.getUint8(i);
    hexString += `${byte.toString(16).padStart(2, "0")} `;
  }
  return hexString.trim();
}
