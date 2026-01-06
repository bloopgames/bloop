#!/usr/bin/env bun
/**
 * Tape inspection script for debugging tape contents
 * Usage: bun bin/inspect-tape.ts <path-to-tape-file>
 */

const TAPE_MAGIC = 0x54415045; // "TAPE" in ASCII

interface TapeHeader {
  magic: number;
  version: number;
  eventCount: number;
  startFrame: number;
  frameCount: number;
  maxEvents: number;
  snapshotOffset: number;
  userDataOffset: number;
  eventStartOffset: number;
  eventEndOffset: number;
  packetStartOffset: number;
  packetEndOffset: number;
  packetCount: number;
  maxPacketBytes: number;
}

interface SnapshotHeader {
  version: number;
  userDataLen: number;
  engineDataLen: number;
  snapshotLen: number;
  timeLen: number;
  inputLen: number;
  netLen: number;
  eventsLen: number;
  inputBufferLen: number;
  // TimeCtx fields (after the header fields)
  timeFrame: number;
  timeDtMs: number;
  timeTotalMs: bigint;
  // NetCtx fields (after InputCtx)
  netPeerCount: number;
  netLocalPeerId: number;
  netInSession: number;
  netStatus: number;
  netMatchFrame: number;
  netSessionStartFrame: number;
}

function readTapeHeader(view: DataView): TapeHeader {
  const magic = view.getUint32(0, true);
  if (magic !== TAPE_MAGIC) {
    throw new Error(
      `Invalid tape format: expected magic ${TAPE_MAGIC.toString(16)}, got ${magic.toString(16)}`,
    );
  }
  return {
    magic,
    version: view.getUint16(4, true),
    eventCount: view.getUint16(6, true),
    startFrame: view.getUint32(8, true),
    frameCount: view.getUint32(12, true),
    maxEvents: view.getUint32(16, true),
    snapshotOffset: view.getUint32(20, true),
    userDataOffset: view.getUint32(24, true),
    eventStartOffset: view.getUint32(28, true),
    eventEndOffset: view.getUint32(32, true),
    packetStartOffset: view.getUint32(36, true),
    packetEndOffset: view.getUint32(40, true),
    packetCount: view.getUint32(44, true),
    maxPacketBytes: view.getUint32(48, true),
  };
}

function readSnapshotHeader(view: DataView, offset: number): SnapshotHeader {
  // After 9 u32s (36 bytes), there's 4 bytes padding before TimeCtx
  // because TimeCtx contains a u64 which needs 8-byte alignment
  const TIME_CTX_OFFSET = 40; // 36 bytes + 4 bytes padding

  // TimeCtx size: frame(4) + dt_ms(4) + total_ms(8) + is_resimulating(1) + padding(7) = 24 bytes
  // InputCtx size: 12 players * (KeyCtx(256) + MouseCtx(24)) = 12 * 280 = 3360 bytes
  const INPUT_CTX_OFFSET = TIME_CTX_OFFSET + 24; // offset 64
  const NET_CTX_OFFSET = INPUT_CTX_OFFSET + 3360; // offset 3424

  return {
    version: view.getUint32(offset + 0, true),
    userDataLen: view.getUint32(offset + 4, true),
    engineDataLen: view.getUint32(offset + 8, true),
    snapshotLen: view.getUint32(offset + 12, true),
    timeLen: view.getUint32(offset + 16, true),
    inputLen: view.getUint32(offset + 20, true),
    netLen: view.getUint32(offset + 24, true),
    eventsLen: view.getUint32(offset + 28, true),
    inputBufferLen: view.getUint32(offset + 32, true),
    // TimeCtx starts at offset 40 (36 bytes of u32s + 4 bytes padding for u64 alignment)
    timeFrame: view.getUint32(offset + TIME_CTX_OFFSET, true),
    timeDtMs: view.getUint32(offset + TIME_CTX_OFFSET + 4, true),
    timeTotalMs: view.getBigUint64(offset + TIME_CTX_OFFSET + 8, true),
    // NetCtx (after InputCtx)
    netPeerCount: view.getUint8(offset + NET_CTX_OFFSET),
    netLocalPeerId: view.getUint8(offset + NET_CTX_OFFSET + 1),
    netInSession: view.getUint8(offset + NET_CTX_OFFSET + 2),
    netStatus: view.getUint8(offset + NET_CTX_OFFSET + 3),
    netMatchFrame: view.getUint32(offset + NET_CTX_OFFSET + 4, true),
    netSessionStartFrame: view.getUint32(offset + NET_CTX_OFFSET + 8, true),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun bin/inspect-tape.ts <path-to-tape-file>");
    process.exit(1);
  }

  const filePath = args[0];
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const bytes = await file.arrayBuffer();
  const view = new DataView(bytes);

  console.log("=== TAPE INSPECTION ===\n");
  console.log(`File: ${filePath}`);
  console.log(`Size: ${bytes.byteLength} bytes\n`);

  // Read tape header
  const header = readTapeHeader(view);
  console.log("--- Tape Header ---");
  console.log(`  Version: ${header.version}`);
  console.log(`  Start Frame: ${header.startFrame}`);
  console.log(`  Frame Count: ${header.frameCount}`);
  console.log(`  Event Count: ${header.eventCount}`);
  console.log(`  Max Events: ${header.maxEvents}`);
  console.log(`  Packet Count: ${header.packetCount}`);
  console.log(`  Snapshot Offset: ${header.snapshotOffset}`);
  console.log(`  User Data Offset: ${header.userDataOffset}`);
  console.log(`  Event Start Offset: ${header.eventStartOffset}`);
  console.log(`  Event End Offset: ${header.eventEndOffset}`);
  console.log();

  // Read snapshot header
  const snapshot = readSnapshotHeader(view, header.snapshotOffset);
  console.log("--- Snapshot Header ---");
  console.log(`  Version: ${snapshot.version}`);
  console.log(`  User Data Len: ${snapshot.userDataLen}`);
  console.log(`  Engine Data Len: ${snapshot.engineDataLen}`);
  console.log(`  Input Buffer Len: ${snapshot.inputBufferLen}`);
  console.log(`  Time Len: ${snapshot.timeLen}`);
  console.log(`  Input Len: ${snapshot.inputLen}`);
  console.log(`  Net Len: ${snapshot.netLen}`);
  console.log(`  Events Len: ${snapshot.eventsLen}`);
  console.log();
  console.log("--- TimeCtx ---");
  console.log(`  Frame: ${snapshot.timeFrame}`);
  console.log(`  Dt (ms): ${snapshot.timeDtMs}`);
  console.log(`  Total (ms): ${snapshot.timeTotalMs}`);
  console.log();
  console.log("--- NetCtx ---");
  console.log(`  Peer Count: ${snapshot.netPeerCount}`);
  console.log(`  Local Peer ID: ${snapshot.netLocalPeerId}`);
  console.log(`  In Session: ${snapshot.netInSession}`);
  console.log(`  Status: ${snapshot.netStatus}`);
  console.log(`  Match Frame: ${snapshot.netMatchFrame}`);
  console.log(`  Session Start Frame: ${snapshot.netSessionStartFrame}`);
  console.log();

  // Read and parse user data (bag)
  if (snapshot.userDataLen > 0) {
    const userDataStart = header.userDataOffset;
    const userDataEnd = userDataStart + snapshot.userDataLen;
    const userDataBytes = new Uint8Array(
      bytes,
      userDataStart,
      snapshot.userDataLen,
    );
    const decoder = new TextDecoder();
    const userDataJson = decoder.decode(userDataBytes);

    console.log("--- User Data (Bag) ---");
    try {
      const bag = JSON.parse(userDataJson);
      console.log(`  phase: ${bag.phase}`);
      console.log(`  mode: ${bag.mode}`);

      // Print full bag structure
      console.log();
      console.log("--- Full Bag JSON ---");
      console.log(JSON.stringify(bag, null, 2));
    } catch (e) {
      console.log(`  Failed to parse JSON: ${e}`);
      console.log(`  Raw (first 500 chars): ${userDataJson.slice(0, 500)}`);
    }
  } else {
    console.log("--- User Data (Bag) ---");
    console.log("  (empty)");
  }

  console.log();
}

main().catch(console.error);
