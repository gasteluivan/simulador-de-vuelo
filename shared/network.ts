import { validControl, type Control } from "./control.js";

export const PACKET_BYTES = 24;
export const MAX_BACKLOG = 4096;
export const MAX_CONTROL_BACKLOG = 2 * PACKET_BYTES;
export const MAX_PACKET_AGE = 250;
export interface ControlPacket {
  seq: number;
  timestamp: number;
  control: Control;
}
export function newerSequence(seq: number, previous: number): boolean {
  const distance = (seq - previous) >>> 0;
  return distance !== 0 && distance < 0x80000000;
}
export function encodePacket(
  packet: ControlPacket,
  target?: ArrayBuffer,
): ArrayBuffer {
  if (
    !validControl(packet.control) ||
    !Number.isInteger(packet.seq) ||
    packet.seq < 0 ||
    packet.seq > 0xffffffff ||
    !Number.isFinite(packet.timestamp) ||
    packet.timestamp < 0
  )
    throw new Error("Invalid control packet");
  if (target && target.byteLength !== PACKET_BYTES)
    throw new Error("Invalid packet buffer size");
  const buffer = target ?? new ArrayBuffer(PACKET_BYTES),
    v = new DataView(buffer);
  v.setUint8(0, 1);
  v.setUint8(1, packet.control.turbo ? 1 : 0);
  v.setUint32(4, packet.seq, true);
  v.setFloat64(8, packet.timestamp, true);
  v.setFloat32(16, packet.control.x, true);
  v.setFloat32(20, packet.control.y, true);
  // Throttle uses the two remaining header bytes (unsigned normalized 16 bit).
  v.setUint16(2, Math.round(packet.control.throttle * 65535), true);
  return buffer;
}
export function decodePacket(
  buffer: ArrayBuffer | ArrayBufferView,
): ControlPacket | undefined {
  const v = ArrayBuffer.isView(buffer)
    ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new DataView(buffer);
  if (v.byteLength !== PACKET_BYTES || v.getUint8(0) !== 1 || v.getUint8(1) > 1)
    return;
  const packet = {
    seq: v.getUint32(4, true),
    timestamp: v.getFloat64(8, true),
    control: {
      x: v.getFloat32(16, true),
      y: v.getFloat32(20, true),
      throttle: v.getUint16(2, true) / 65535,
      turbo: v.getUint8(1) === 1,
    },
  };
  return validControl(packet.control) &&
    Number.isFinite(packet.timestamp) &&
    packet.timestamp >= 0
    ? packet
    : undefined;
}
export function validSignal(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (s.kind === "offer" || s.kind === "answer")
    return (
      typeof s.sdp === "string" &&
      s.sdp.length > 0 &&
      s.sdp.length <= 16000 &&
      Object.keys(s).every((k) => k === "kind" || k === "sdp")
    );
  if (
    s.kind !== "candidate" ||
    typeof s.candidate !== "string" ||
    s.candidate.length > 2048
  )
    return false;
  return (
    (s.sdpMid === null ||
      (typeof s.sdpMid === "string" && s.sdpMid.length <= 256)) &&
    (s.sdpMLineIndex === null ||
      (Number.isInteger(s.sdpMLineIndex) &&
        Number(s.sdpMLineIndex) >= 0 &&
        Number(s.sdpMLineIndex) <= 255)) &&
    Object.keys(s).every((k) =>
      ["kind", "candidate", "sdpMid", "sdpMLineIndex"].includes(k),
    )
  );
}
