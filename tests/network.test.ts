import { test } from "node:test";
import assert from "node:assert/strict";
import { Link } from "../client/src/link";
import {
  decodePacket,
  encodePacket,
  newerSequence,
  validSignal,
} from "../shared/network";

test("24 byte packet round trips sequence, timestamp and bounded controls", () => {
  const control = { x: -0.25, y: 0.5, throttle: 0.7, turbo: true };
  const bytes = encodePacket({
    seq: 0xffffffff,
    timestamp: 12345.125,
    control,
  });
  assert.equal(bytes.byteLength, 24);
  const p = decodePacket(bytes)!;
  assert.equal(p.seq, 0xffffffff);
  assert.equal(p.timestamp, 12345.125);
  assert.equal(p.control.x, control.x);
  assert.equal(p.control.y, control.y);
  assert.equal(p.control.turbo, true);
  assert.ok(Math.abs(p.control.throttle - control.throttle) <= 1 / 65535);
  const padded = new Uint8Array(30);
  padded.set(new Uint8Array(bytes), 3);
  assert.deepEqual(decodePacket(padded.subarray(3, 27)), p);
});
test("codec rejects malformed and unsafe controls", () => {
  const packet = {
    seq: 1,
    timestamp: 0,
    control: { x: 0, y: 0, throttle: 0, turbo: false },
  };
  assert.throws(() => encodePacket({ ...packet, timestamp: NaN }));
  assert.throws(() => encodePacket({ ...packet, seq: -1 }));
  assert.throws(() =>
    encodePacket({ ...packet, control: { ...packet.control, x: 2 } }),
  );
  assert.equal(decodePacket(new ArrayBuffer(23)), undefined);
  for (const mutate of [
    (v: DataView) => v.setUint8(0, 2),
    (v: DataView) => v.setUint8(1, 2),
    (v: DataView) => v.setFloat64(8, Infinity, true),
    (v: DataView) => v.setFloat32(16, NaN, true),
    (v: DataView) => v.setFloat32(20, 1.1, true),
  ]) {
    const bytes = encodePacket(packet);
    mutate(new DataView(bytes));
    assert.equal(decodePacket(bytes), undefined);
  }
});

test("encoder reuses caller storage and validates its exact size", () => {
  const target = new ArrayBuffer(24);
  const packet = {
    seq: 1,
    timestamp: 1,
    control: { x: 0, y: 0, throttle: 1, turbo: false },
  };
  assert.equal(encodePacket(packet, target), target);
  assert.equal(encodePacket({ ...packet, seq: 2 }, target), target);
  assert.equal(decodePacket(target)!.seq, 2);
  assert.throws(() => encodePacket(packet, new ArrayBuffer(25)));
});
test("sequence ordering handles wrap and rejects duplicates and delayed packets", () => {
  assert.ok(newerSequence(0, 0xffffffff));
  assert.ok(newerSequence(42, 40));
  assert.equal(newerSequence(40, 40), false);
  assert.equal(newerSequence(39, 40), false);
  assert.equal(newerSequence(0xffffffff, 0), false);
  assert.equal(newerSequence(0x80000000, 0), false);
});
test("signaling validates bounded SDP and ICE without accepting arbitrary payloads", () => {
  assert.ok(validSignal({ kind: "offer", sdp: "v=0" }));
  assert.ok(
    validSignal({
      kind: "candidate",
      candidate: "candidate:1",
      sdpMid: "0",
      sdpMLineIndex: 0,
    }),
  );
  for (const s of [
    null,
    {},
    { kind: "offer", sdp: "x".repeat(16001) },
    { kind: "answer", sdp: "v=0", token: "secret" },
    { kind: "candidate", candidate: "x", sdpMid: "0", sdpMLineIndex: -1 },
  ])
    assert.equal(validSignal(s), false);
});

test("Link rejects reordered arrivals without trusting clocks and resets on disconnect", (t) => {
  let now = 100;
  t.mock.method(performance, "now", () => now);
  const original = globalThis.WebSocket;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    binaryType = "";
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    send() {}
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  const link = new Link("host", () => {}, "http://localhost");
  try {
    const socket = link.socket as unknown as Socket;
    socket.onmessage?.({ data: JSON.stringify({ type: "connected" }) });
    assert.equal(link.transport, "websocket");
    const control = { x: 0.5, y: 0, throttle: 0.5, turbo: false };
    const deliver = (seq: number, timestamp: number, x = 0.5) =>
      socket.onmessage?.({
        data: encodePacket({ seq, timestamp, control: { ...control, x } }),
      });
    deliver(5, 1e12);
    assert.equal(link.control.x, 0.5);
    deliver(4, 1e13, -1);
    deliver(5, 0, -1);
    assert.equal(link.control.x, 0.5);
    assert.ok(link.packetAge >= 0 && link.packetAge < 1000);
    deliver(6, 0, 1);
    assert.equal(link.control.x, 1);
    assert.ok(Number.isFinite(link.jitter));
    now += 400;
    deliver(7, 10, -1);
    assert.equal(link.control.x, 1, "relative delay over 250ms is dropped");
    deliver(8, 400, 0.25);
    assert.equal(
      link.control.x,
      0.25,
      "fresh state recovers after queue drains",
    );
    socket.onmessage?.({ data: JSON.stringify({ type: "disconnected" }) });
    assert.equal(link.connected, false);
    assert.equal(link.packetAge, Infinity);
    assert.equal(link.control.x, 0);
    assert.equal(link.transport, "disconnected");
  } finally {
    link.close();
    globalThis.WebSocket = original;
  }
});

test("latest-only sender reuses storage, expires pending state, and limits control backlog", (t) => {
  let now = 100;
  t.mock.method(performance, "now", () => now);
  const original = globalThis.WebSocket;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 49;
    sent: ArrayBuffer[] = [];
    references: unknown[] = [];
    send(data: ArrayBuffer) {
      this.references.push(data);
      this.sent.push(data.slice(0));
    }
    close() {}
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  const link = new Link("host", () => {}, "http://localhost");
  const internal = link as any;
  try {
    internal.role = "remote";
    link.connected = true;
    const socket = link.socket as unknown as Socket;
    const send = (x: number) =>
      link.send({
        type: "control",
        control: { x, y: 0, throttle: 0.5, turbo: false },
      });
    send(0.25);
    send(0.5);
    assert.equal(socket.sent.length, 0);
    socket.bufferedAmount = 48;
    internal.flush();
    assert.equal(decodePacket(socket.sent[0])!.control.x, 0.5);
    send(1);
    assert.equal(socket.references[0], socket.references[1]);
    assert.equal(
      decodePacket(socket.sent[0])!.control.x,
      0.5,
      "send snapshot survives buffer reuse",
    );
    socket.bufferedAmount = 49;
    send(-1);
    now += 251;
    socket.bufferedAmount = 0;
    internal.flush();
    assert.equal(socket.sent.length, 2, "expired pending packet is discarded");
    send(0);
    assert.equal(socket.sent.length, 3);
  } finally {
    link.close();
    globalThis.WebSocket = original;
  }
});

test("RTC serializes candidate-before-offer and ignores failures from an old connection", async () => {
  const originalSocket = globalThis.WebSocket,
    originalPC = globalThis.RTCPeerConnection;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    send() {}
    close() {}
  }
  let release!: () => void;
  let failDescription = false;
  const calls: string[] = [];
  class Peer {
    remoteDescription: unknown;
    close() {
      calls.push("close");
    }
    async setRemoteDescription(description: unknown) {
      calls.push("description:start");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (failDescription) throw new Error("Old peer closed during negotiation");
      this.remoteDescription = description;
      calls.push("description:end");
    }
    async addIceCandidate() {
      assert.ok(this.remoteDescription);
      calls.push("candidate");
    }
    async createAnswer() {
      calls.push("answer");
      return { type: "answer", sdp: "v=0" };
    }
    async setLocalDescription() {
      calls.push("local");
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  globalThis.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
  const link = new Link("host", () => {}, "http://localhost");
  const internal = link as any;
  try {
    internal.role = "remote";
    link.connected = true;
    const candidate = {
      kind: "candidate",
      candidate: "candidate:1",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };
    await internal.signal(candidate);
    const offer = internal.signal({ kind: "offer", sdp: "v=0" });
    await Promise.resolve();
    const later = internal.signal(candidate);
    assert.deepEqual(calls, ["description:start"]);
    release();
    await offer;
    await later;
    assert.deepEqual(calls, [
      "description:start",
      "description:end",
      "candidate",
      "answer",
      "local",
      "candidate",
    ]);
    const old = internal.signal({ kind: "offer", sdp: "v=0" });
    await Promise.resolve();
    internal.cleanupRTC();
    await internal.signal(candidate);
    const replacement = internal.pc;
    failDescription = true;
    release();
    await old;
    assert.equal(
      internal.pc,
      replacement,
      "old async operation cannot close replacement",
    );
    assert.equal(calls.filter((c) => c === "answer").length, 1);
  } finally {
    link.close();
    globalThis.WebSocket = originalSocket;
    globalThis.RTCPeerConnection = originalPC;
  }
});
