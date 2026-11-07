import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { encodePacket, decodePacket } from "../shared/network";
function message(socket: WebSocket, type: string) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", handler);
      reject(Error(`Timeout: ${type}`));
    }, 5000);
    const handler = (raw: any, binary: boolean) => {
      if (binary) return;
      const data = JSON.parse(raw.toString());
      if (data.type === type) {
        clearTimeout(timer);
        socket.off("message", handler);
        resolve(data);
      }
    };
    socket.on("message", handler);
  });
}
async function connect() {
  const socket = new WebSocket("ws://127.0.0.1:3099/ws");
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}
test("room authorizes one remote, relays controls, rejects bad token, reports disconnect", async () => {
  const server = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      env: { ...process.env, PORT: "3099" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const sockets: WebSocket[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Server did not start")),
        10000,
      );
      server.stdout.on("data", () => {
        clearTimeout(timer);
        resolve();
      });
      server.once("error", reject);
    });
    const host = await connect();
    sockets.push(host);
    const created = message(host, "room");
    host.send(JSON.stringify({ type: "create" }));
    const room = await created;
    const remote = await connect();
    sockets.push(remote);
    let error = message(remote, "error");
    remote.send(
      JSON.stringify({ type: "join", room: room.room, token: "bad" }),
    );
    assert.match((await error).message, /inválido/);
    const joined = message(remote, "joined"),
      connected = message(host, "connected");
    remote.send(
      JSON.stringify({ type: "join", room: room.room, token: room.token }),
    );
    await joined;
    await connected;
    const other = await connect();
    sockets.push(other);
    error = message(other, "error");
    other.send(
      JSON.stringify({ type: "join", room: room.room, token: room.token }),
    );
    assert.match((await error).message, /ya tiene/);
    const received = message(host, "control");
    const control = { x: 0.3, y: -0.2, throttle: 0.7, turbo: false };
    remote.send(JSON.stringify({ type: "control", control, seq: 1 }));
    assert.deepEqual((await received).control, control);
    const signal = message(remote, "signal");
    host.send(
      JSON.stringify({ type: "signal", signal: { kind: "offer", sdp: "v=0" } }),
    );
    assert.deepEqual((await signal).signal, { kind: "offer", sdp: "v=0" });
    const unexpected: unknown[] = [];
    const watch = (raw: Buffer, binary: boolean) => {
      if (!binary && JSON.parse(raw.toString()).type === "signal")
        unexpected.push(JSON.parse(raw.toString()));
    };
    host.on("message", watch);
    remote.on("message", watch);
    // Unregistered sockets cannot signal into a room, and the wrong peer cannot offer.
    other.send(
      JSON.stringify({
        type: "signal",
        room: room.room,
        signal: { kind: "offer", sdp: "v=0" },
      }),
    );
    remote.send(
      JSON.stringify({ type: "signal", signal: { kind: "offer", sdp: "v=0" } }),
    );
    host.send(
      JSON.stringify({
        type: "signal",
        signal: { kind: "offer", sdp: "x".repeat(16001) },
      }),
    );
    host.send(
      JSON.stringify({
        type: "signal",
        signal: {
          kind: "candidate",
          candidate: {},
          sdpMid: null,
          sdpMLineIndex: null,
        },
      }),
    );
    const probe = message(remote, "probe");
    host.send(JSON.stringify({ type: "probe", id: 77 }));
    assert.equal((await probe).id, 77);
    const echo = message(host, "echo");
    remote.send(JSON.stringify({ type: "echo", id: 77 }));
    assert.equal((await echo).id, 77);
    const packets: number[] = [];
    const collect = (raw: Buffer, binary: boolean) => {
      if (binary) packets.push(decodePacket(raw)!.seq);
    };
    host.on("message", collect);
    remote.send(encodePacket({ seq: 2, timestamp: 999999999, control }));
    remote.send(encodePacket({ seq: 2, timestamp: 0, control }));
    remote.send(encodePacket({ seq: 1, timestamp: 9999999999, control }));
    remote.send(new Uint8Array(24));
    // A subsequent ordered ping ensures the server processed all preceding packets.
    const pong = message(remote, "pong");
    remote.send(JSON.stringify({ type: "ping", sent: 123 }));
    await pong;
    await new Promise((resolve) => setTimeout(resolve, 40));
    host.off("message", watch);
    remote.off("message", watch);
    assert.deepEqual(unexpected, []);
    host.off("message", collect);
    assert.deepEqual(packets, [2]);
    const collision = message(remote, "collision");
    host.send(JSON.stringify({ type: "collision" }));
    await collision;
    const disconnected = message(host, "disconnected");
    remote.close();
    await disconnected;
  } finally {
    for (const s of sockets) s.terminate();
    server.kill();
  }
});
