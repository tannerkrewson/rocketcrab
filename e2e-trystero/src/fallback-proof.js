// Browser-only viability experiment, deliberately not used by Nova.
// Direct 0.27 access is essential here: Nova's adapter still pins 0.26.
// oxlint-disable-next-line no-restricted-imports
import { joinRoom } from "@trystero-p2p/ws-relay";

const state = { peers: 0, messages: [], tunnels: 0, nativeOpens: 0, errors: [] };
const forced = new URLSearchParams(location.search).has("blocked");
const wsBase = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/fixture-ws`;

class Channel {
  constructor(native) {
    this.native = native;
    this.readyState = "connecting";
    this.bufferedAmount = 0;
    if (native) {
      native.binaryType = "arraybuffer";
      native.onopen = () => {
        if (this.socket) return;
        state.nativeOpens++;
        this.readyState = "open";
        this.onopen?.(new Event("open"));
      };
      native.onmessage = (event) => {
        if (!this.socket) this.onmessage?.(event);
      };
      // A failed native channel must not close the facade before fallback.
      native.onclose = () => {
        if (this.readyState === "open" && !this.socket) this.onclose?.(new Event("close"));
      };
    }
  }
  send(data) {
    (this.socket ?? this.native).send(data);
  }
  close() {
    this.readyState = "closed";
    this.socket?.close();
    this.native?.close();
  }
  openTunnel(socket) {
    this.socket = socket;
    this.readyState = "open";
    this.onopen?.(new Event("open"));
  }
}

class ProofPeerConnection {
  constructor(config) {
    const pc = new RTCPeerConnection(
      forced ? { ...config, iceServers: [], iceTransportPolicy: "relay" } : config,
    );
    let channel;
    let timer;
    let closed = false;
    let tunnel = false;
    let ondatachannel;
    const schedule = () => {
      if (timer || !pc.localDescription || !pc.remoteDescription) return;
      timer = setTimeout(async () => {
        if (closed || pc.connectionState === "connected" || channel?.readyState === "open") return;
        try {
          const fingerprints = [pc.localDescription.sdp, pc.remoteDescription.sdp].map(
            (sdp) => sdp.match(/^a=fingerprint:([^\r\n]+)/m)?.[1],
          );
          if (fingerprints.some((value) => !value)) throw new Error("missing DTLS fingerprint");
          const key = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(fingerprints.sort().join("|")),
          );
          const id = Array.from(new Uint8Array(key), (b) => b.toString(16).padStart(2, "0")).join(
            "",
          );
          const socket = new WebSocket(`${wsBase}/tunnel/${id}`);
          socket.binaryType = "arraybuffer";
          socket.onmessage = (event) => {
            if (event.data === "ready") {
              if (closed) return socket.close();
              tunnel = true;
              state.tunnels++;
              if (!channel) {
                channel = new Channel();
                ondatachannel?.({ channel });
              }
              channel.openTunnel(socket);
            } else channel?.onmessage?.(event);
          };
          socket.onerror = () => state.errors.push("tunnel error");
          socket.onclose = () => {
            if (tunnel && !closed) channel?.onclose?.(new Event("close"));
          };
        } catch (error) {
          state.errors.push(String(error));
        }
      }, 2500);
    };
    pc.ondatachannel = (event) => {
      if (tunnel) return;
      channel = new Channel(event.channel);
      ondatachannel?.({ channel });
    };
    return new Proxy(pc, {
      get(target, prop) {
        if (prop === "ondatachannel") return ondatachannel;
        if (prop === "connectionState")
          return tunnel
            ? "connected"
            : ["failed", "disconnected"].includes(target.connectionState)
              ? "connecting"
              : target.connectionState;
        if (prop === "iceConnectionState")
          return tunnel
            ? "connected"
            : ["failed", "disconnected"].includes(target.iceConnectionState)
              ? "checking"
              : target.iceConnectionState;
        if (prop === "createDataChannel")
          return (...args) => (channel = new Channel(target.createDataChannel(...args)));
        if (prop === "setLocalDescription" || prop === "setRemoteDescription")
          return async (...args) => {
            const result = await target[prop](...args);
            schedule();
            return result;
          };
        if (prop === "close")
          return () => {
            closed = true;
            clearTimeout(timer);
            target.close();
          };
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, prop, value) {
        if (prop === "ondatachannel") ondatachannel = value;
        else target[prop] = value;
        return true;
      },
    });
  }
}

window.proof = {
  state,
  join(roomId) {
    const room = joinRoom(
      {
        appId: "fallback-proof",
        rtcPolyfill: ProofPeerConnection,
        rtcConfig: { iceServers: [] },
        relayConfig: { urls: [`${wsBase}/signal`] },
      },
      roomId,
    );
    room.onPeerJoin(() => state.peers++);
    const action = room.makeAction("proof");
    action.onMessage((message) => state.messages.push(message));
    this.send = (message) => action.send(message);
    this.leave = () => room.leave();
  },
};
