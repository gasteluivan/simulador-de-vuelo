import { neutral, validControl } from "../../shared/control";
import {
  decodePacket,
  encodePacket,
  newerSequence,
  validSignal,
  MAX_BACKLOG,
  MAX_CONTROL_BACKLOG,
  MAX_PACKET_AGE,
  PACKET_BYTES,
} from "../../shared/network";

export class Link {
  socket?: WebSocket;
  room = "";
  token = "";
  connected = false;
  control = neutral();
  lastPacket = 0;
  latency = 0;
  jitter = 0;
  peerLatency = 0;
  get transport(): string {
    return this.channel?.readyState === "open"
      ? "webrtc"
      : this.connected
        ? "websocket"
        : "disconnected";
  }
  get packetAge(): number {
    return this.lastPacket ? performance.now() - this.lastPacket : Infinity;
  }
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private retry?: ReturnType<typeof setTimeout>;
  private rtcTimeout?: ReturnType<typeof setTimeout>;
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private seq = 0;
  private receivedSeq?: number;
  private pending?: ArrayBuffer;
  private packetBuffer = new ArrayBuffer(PACKET_BYTES);
  private pendingSentAt = 0;
  private transitBaseline?: number;
  private signalQueue: Promise<void> = Promise.resolve();
  private rtcGeneration = 0;
  private probes = new Map<number, number>();
  private probeId = 0;
  private pingSent?: number;
  private previousArrival = 0;
  private previousTimestamp = 0;
  private candidates: RTCIceCandidateInit[] = [];
  constructor(
    private role: "host" | "remote",
    private onEvent: (data: any) => void,
    private endpoint = location.origin,
  ) {
    if (role === "remote") {
      const q = new URLSearchParams(location.search);
      this.room = q.get("room") || "";
      this.token = q.get("token") || "";
    }
    this.connect();
    this.timer = setInterval(() => {
      this.flush();
      const now = performance.now();
      if (
        this.connected &&
        (this.pingSent === undefined || now - this.pingSent >= 2000)
      ) {
        this.pingSent = now;
        this.ws({ type: "ping", sent: now });
        this.probes.clear();
        const id = ++this.probeId;
        this.probes.set(id, now);
        this.peer({ type: "probe", id });
      }
    }, 25);
  }
  private ws(data: unknown) {
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount < MAX_BACKLOG
    )
      this.socket.send(JSON.stringify(data));
  }
  private peer(data: unknown) {
    if (
      this.channel?.readyState === "open" &&
      this.channel.bufferedAmount < MAX_BACKLOG
    ) {
      try {
        this.channel.send(JSON.stringify(data));
        return;
      } catch {
        this.cleanupRTC();
      }
    }
    this.ws(data);
  }
  private cleanupRTC() {
    ++this.rtcGeneration;
    this.signalQueue = Promise.resolve();
    clearTimeout(this.rtcTimeout);
    const channel = this.channel,
      pc = this.pc;
    this.channel = undefined;
    this.pc = undefined;
    this.candidates = [];
    if (channel) {
      channel.onclose =
        channel.onerror =
        channel.onmessage =
        channel.onopen =
          null;
      channel.close();
    }
    if (pc) {
      pc.onicecandidate = pc.ondatachannel = pc.onconnectionstatechange = null;
      pc.close();
    }
  }
  private reset() {
    this.cleanupRTC();
    this.connected = false;
    this.control = neutral();
    this.lastPacket = 0;
    this.receivedSeq = undefined;
    this.pending = undefined;
    this.probes.clear();
    this.previousArrival = 0;
    this.previousTimestamp = 0;
    this.transitBaseline = undefined;
    this.jitter = 0;
    this.peerLatency = 0;
  }
  private attach(channel: RTCDataChannel) {
    if (
      this.channel ||
      channel.label !== "control" ||
      channel.ordered ||
      channel.maxRetransmits !== 0
    ) {
      channel.close();
      return;
    }
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      clearTimeout(this.rtcTimeout);
      this.flush();
    };
    channel.onmessage = (e) => this.receive(e.data);
    channel.onclose = channel.onerror = () => this.cleanupRTC();
  }
  private signal(signal?: any) {
    const generation = this.rtcGeneration;
    this.signalQueue = this.signalQueue.then(async () => {
      if (generation === this.rtcGeneration) await this.applySignal(signal);
    });
    // applySignal handles browser failures; keep the queue usable on unexpected errors too.
    this.signalQueue = this.signalQueue.catch(() => {
      if (generation === this.rtcGeneration) this.cleanupRTC();
    });
    return this.signalQueue;
  }
  private async applySignal(signal?: any) {
    let pc = this.pc;
    try {
      if (!this.connected || typeof RTCPeerConnection === "undefined") return;
      if (!pc) {
        pc = this.pc = new RTCPeerConnection({ iceServers: [] });
        const active = pc;
        pc.onicecandidate = (e) => {
          if (e.candidate && this.pc === active)
            this.ws({
              type: "signal",
              signal: {
                kind: "candidate",
                candidate: e.candidate.candidate,
                sdpMid: e.candidate.sdpMid,
                sdpMLineIndex: e.candidate.sdpMLineIndex,
              },
            });
        };
        pc.ondatachannel = (e) => this.attach(e.channel);
        pc.onconnectionstatechange = () => {
          if (
            this.pc === active &&
            ["failed", "disconnected", "closed"].includes(
              active.connectionState,
            )
          )
            this.cleanupRTC();
        };
        this.rtcTimeout = setTimeout(() => {
          if (this.pc === active) this.cleanupRTC();
        }, 8000);
      }
      if (!signal && this.role === "host") {
        this.attach(
          pc.createDataChannel("control", {
            ordered: false,
            maxRetransmits: 0,
          }),
        );
        const offer = await pc.createOffer();
        if (this.pc !== pc) return;
        await pc.setLocalDescription(offer);
        if (this.pc !== pc) return;
        this.ws({ type: "signal", signal: { kind: "offer", sdp: offer.sdp } });
      } else if (signal?.kind === "candidate") {
        const candidate = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex,
        };
        if (pc.remoteDescription) await pc.addIceCandidate(candidate);
        else if (this.candidates.length < 64) this.candidates.push(candidate);
      } else if (signal) {
        if ((signal.kind === "offer") !== (this.role === "remote")) return;
        await pc.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });
        if (this.pc !== pc) return;
        for (const candidate of this.candidates.splice(0)) {
          await pc.addIceCandidate(candidate);
          if (this.pc !== pc) return;
        }
        if (signal.kind === "offer") {
          const answer = await pc.createAnswer();
          if (this.pc !== pc) return;
          await pc.setLocalDescription(answer);
          if (this.pc !== pc) return;
          this.ws({
            type: "signal",
            signal: { kind: "answer", sdp: answer.sdp },
          });
        }
      }
    } catch {
      if (pc && this.pc === pc) this.cleanupRTC();
    }
  }
  private connect() {
    if (this.stopped) return;
    const url = new URL("/ws", this.endpoint);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = (this.socket = new WebSocket(url));
    socket.binaryType = "arraybuffer";
    socket.onopen = () =>
      this.ws(
        this.role === "host"
          ? { type: "create" }
          : { type: "join", room: this.room, token: this.token },
      );
    socket.onmessage = (e) => {
      if (this.socket === socket) this.receive(e.data);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.reset();
      this.onEvent({ type: "disconnected" });
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), 1800);
    };
    socket.onerror = () => socket.close();
  }
  private receive(data: unknown) {
    try {
      if (data instanceof ArrayBuffer) {
        const packet = decodePacket(data);
        if (
          this.role !== "host" ||
          !this.connected ||
          !packet ||
          (this.receivedSeq !== undefined &&
            !newerSequence(packet.seq, this.receivedSeq))
        )
          return;
        const now = performance.now();
        // A minimum relative transit removes the unknown clock offset. A clock
        // reset starts a new baseline; absolute sender time never decides freshness.
        const transit = now - packet.timestamp;
        if (
          this.transitBaseline === undefined ||
          packet.timestamp <= this.previousTimestamp
        )
          this.transitBaseline = transit;
        this.transitBaseline = Math.min(this.transitBaseline, transit);
        this.receivedSeq = packet.seq;
        if (transit - this.transitBaseline > MAX_PACKET_AGE) return;
        if (this.previousArrival) {
          const variation = Math.min(
            1000,
            Math.abs(
              now -
                this.previousArrival -
                (packet.timestamp - this.previousTimestamp),
            ),
          );
          this.jitter += (variation - this.jitter) * 0.15;
        }
        this.previousArrival = now;
        this.previousTimestamp = packet.timestamp;
        this.receivedSeq = packet.seq;
        this.control = packet.control;
        this.lastPacket = now;
        this.onEvent({ type: "control", ...packet });
        return;
      }
      if (typeof data !== "string") return;
      const m = JSON.parse(data);
      if (!m || typeof m !== "object") return;
      if (m.type === "room") {
        this.room = m.room;
        this.token = m.token;
      }
      if (m.type === "joined" || m.type === "connected") {
        this.reset();
        this.connected = true;
        if (this.role === "host") void this.signal();
      }
      if (m.type === "disconnected") this.reset();
      if (m.type === "signal" && validSignal(m.signal)) {
        void this.signal(m.signal);
        return;
      }
      if (m.type === "control") {
        if (
          this.role !== "host" ||
          !this.connected ||
          !validControl(m.control) ||
          !Number.isInteger(m.seq) ||
          m.seq < 0 ||
          m.seq > 0xffffffff ||
          (this.receivedSeq !== undefined &&
            !newerSequence(m.seq, this.receivedSeq))
        )
          return;
        this.receivedSeq = m.seq;
        this.control = m.control;
        this.lastPacket = performance.now();
      }
      if (m.type === "pong" && m.sent === this.pingSent)
        this.latency = performance.now() - m.sent;
      if (m.type === "probe" && Number.isSafeInteger(m.id)) {
        this.peer({ type: "echo", id: m.id });
        return;
      }
      if (m.type === "echo" && this.probes.has(m.id)) {
        this.peerLatency = performance.now() - this.probes.get(m.id)!;
        this.probes.delete(m.id);
        return;
      }
      this.onEvent(m);
    } catch {
      /* Ignore malformed peer messages. */
    }
  }
  private flush() {
    if (!this.pending || !this.connected) return;
    if (performance.now() - this.pendingSentAt > MAX_PACKET_AGE) {
      this.pending = undefined;
      return;
    }
    const packet = this.pending;
    if (
      this.channel?.readyState === "open" &&
      this.channel.bufferedAmount <= MAX_CONTROL_BACKLOG
    ) {
      try {
        this.channel.send(packet);
        this.pending = undefined;
        return;
      } catch {
        this.cleanupRTC();
      }
    }
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount <= MAX_CONTROL_BACKLOG
    ) {
      this.socket.send(packet);
      this.pending = undefined;
    }
  }
  send(data: unknown) {
    const m = data as any;
    if (m?.type === "control") {
      if (this.role !== "remote" || !this.connected || !validControl(m.control))
        return;
      this.pendingSentAt = performance.now();
      // Browser send() snapshots bytes synchronously. Until sent, this single
      // buffer holds only the latest state and is never queued by reference.
      this.pending = encodePacket(
        {
          seq: (this.seq = (this.seq + 1) >>> 0),
          timestamp: this.pendingSentAt,
          control: m.control,
        },
        this.packetBuffer,
      );
      this.flush();
    } else this.ws(data);
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.timer);
    this.reset();
    if (this.socket) {
      this.socket.onclose =
        this.socket.onmessage =
        this.socket.onopen =
        this.socket.onerror =
          null;
      this.socket.close();
      this.socket = undefined;
    }
  }
  url(origin = location.origin) {
    const url = new URL("/controller", origin);
    url.searchParams.set("room", this.room);
    url.searchParams.set("token", this.token);
    return url.toString();
  }
}
