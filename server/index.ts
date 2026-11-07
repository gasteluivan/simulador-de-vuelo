import express from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { validControl } from "../shared/control.js";
import {
  decodePacket,
  newerSequence,
  validSignal,
  MAX_BACKLOG,
  MAX_CONTROL_BACKLOG,
} from "../shared/network.js";
const app = express(),
  server = createServer(app),
  wss = new WebSocketServer({ server, path: "/ws", maxPayload: 20000 });
type Room = {
  host: WebSocket;
  remote?: WebSocket;
  time: number;
  token: string;
};
const rooms = new Map<string, Room>();
app.get("/api/network", (_req, res) =>
  res.json({
    addresses: Object.values(networkInterfaces())
      .flat()
      .filter((a) => a?.family === "IPv4" && !a.internal)
      .map((a) => a!.address),
  }),
);
// Bypass Vite's module transforms for Emscripten's runtime imports during development.
app.use("/wasm", express.static(resolve("client/public/wasm")));
app.use(express.static(resolve("dist/client")));
app.get("/{*path}", (_req, res) =>
  res.sendFile(resolve("dist/client/index.html")),
);
const send = (s: WebSocket | undefined, data: unknown) => {
  if (s?.readyState === WebSocket.OPEN && s.bufferedAmount < MAX_BACKLOG)
    s.send(JSON.stringify(data));
};
wss.on("connection", (socket) => {
  let id = "",
    role = "";
  let last = 0,
    lastSeq = -1;
  let signalWindow = Date.now(),
    signals = 0;
  const timeout = setTimeout(() => {
    if (!role) socket.close(1008, "Registro requerido");
  }, 10000);
  socket.on("message", (raw, binary) => {
    try {
      const paired = rooms.get(id);
      if (binary) {
        const bytes = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw);
        const packet = decodePacket(bytes);
        if (
          !paired ||
          role !== "remote" ||
          paired.remote !== socket ||
          !packet ||
          (lastSeq !== -1 && !newerSequence(packet.seq, lastSeq))
        )
          return;
        lastSeq = packet.seq;
        paired.time = Date.now();
        if (
          paired.host.readyState === WebSocket.OPEN &&
          paired.host.bufferedAmount <= MAX_CONTROL_BACKLOG
        )
          paired.host.send(bytes, { binary: true });
        return;
      }
      const m = JSON.parse(raw.toString());
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      if (m.type === "create" && !role) {
        id = randomBytes(5).toString("hex").toUpperCase();
        role = "host";
        const token = randomBytes(24).toString("hex");
        rooms.set(id, { host: socket, time: Date.now(), token });
        send(socket, { type: "room", room: id, token });
        return;
      }
      if (m.type === "join" && !role) {
        if (typeof m.room !== "string" || typeof m.token !== "string") return;
        const r = rooms.get(m.room);
        if (!r || r.token !== m.token || r.host.readyState !== WebSocket.OPEN)
          return send(socket, {
            type: "error",
            message: "Sala inexistente o enlace inválido.",
          });
        if (r.remote?.readyState === WebSocket.OPEN)
          return send(socket, {
            type: "error",
            message: "Esta sala ya tiene un mando.",
          });
        id = m.room;
        role = "remote";
        r.remote = socket;
        r.time = Date.now();
        send(socket, { type: "joined" });
        send(r.host, { type: "connected" });
        return;
      }
      const r = rooms.get(id);
      if (!r) return;
      r.time = Date.now();
      const peer = role === "host" ? r.remote : r.host;
      if (m.type === "signal") {
        if (!r.remote || !validSignal(m.signal)) return;
        if (Date.now() - signalWindow > 10000) {
          signalWindow = Date.now();
          signals = 0;
        }
        if (++signals > 128) return;
        if (
          (m.signal.kind === "offer" && role !== "host") ||
          (m.signal.kind === "answer" && role !== "remote")
        )
          return;
        return send(peer, { type: "signal", signal: m.signal });
      }
      if (
        (m.type === "probe" || m.type === "echo") &&
        r.remote &&
        Number.isSafeInteger(m.id) &&
        m.id >= 0
      )
        return send(peer, { type: m.type, id: m.id });
      if (m.type === "ping")
        return typeof m.sent === "number" && Number.isFinite(m.sent)
          ? send(socket, { type: "pong", sent: m.sent })
          : undefined;
      if (
        role === "remote" &&
        m.type === "control" &&
        validControl(m.control) &&
        Number.isSafeInteger(m.seq) &&
        m.seq >= 0 &&
        m.seq <= 0xffffffff &&
        (lastSeq === -1 || newerSequence(m.seq, lastSeq)) &&
        Date.now() - last >= 12
      ) {
        last = Date.now();
        lastSeq = m.seq;
        if (r.host.bufferedAmount <= MAX_CONTROL_BACKLOG)
          send(r.host, { type: "control", control: m.control, seq: m.seq });
      }
      if (role === "host" && m.type === "collision")
        send(r.remote, { type: "collision" });
    } catch {
      send(socket, { type: "error", message: "Mensaje inválido." });
    }
  });
  socket.on("close", () => {
    clearTimeout(timeout);
    const r = rooms.get(id);
    if (!r) return;
    if (role === "host") {
      send(r.remote, { type: "error", message: "La sesión del PC terminó." });
      r.remote?.close();
      rooms.delete(id);
    } else if (r.remote === socket) {
      r.remote = undefined;
      send(r.host, { type: "disconnected" });
    }
  });
});
setInterval(() => {
  for (const [id, r] of rooms)
    if (Date.now() - r.time > 30 * 60 * 1000) {
      r.host.close();
      r.remote?.close();
      rooms.delete(id);
    }
}, 60000).unref();
const port = Number(process.env.PORT || 3001);
server.listen(port, "0.0.0.0", () =>
  console.log(`Servidor de salas: http://localhost:${port}`),
);
