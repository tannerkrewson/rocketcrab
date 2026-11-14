// Test-only raw Trystero room with a seat cap, used to make a real `room-full`
// RoomError happen. Production never sets `maxUsers` (PLAN §3.3: no party cap),
// and the transport has no test-only option for it, so this page calls
// `joinRoom` directly with the same signal URL, identity mode and scale plugin
// as packages/trystero-transport. Errors are mapped with Nova's `fromRoomError`,
// the same function the transport's `room.onError` uses. This does NOT exercise
// the transport's join path (`TrysteroTransport.join`, `onJoinError`).
// oxlint-disable-next-line no-restricted-imports -- test-only raw Trystero to reach a seat cap the adapter does not expose
import { joinRoom, scale } from "@trystero-p2p/ws-relay";
import { fromRoomError } from "../../packages/trystero-transport/src/errors.ts";
import { signalUrl } from "../../packages/trystero-transport/src/signal-url.ts";

const APP_ID = "nova-room-full-e2e";
const EDGE_ORIGIN = "http://localhost:18787";

interface ErrorReport {
  code: string | undefined;
  category: string;
  message: string;
}

const messages: string[] = [];
const errors: ErrorReport[] = [];
let room: ReturnType<typeof joinRoom> | null = null;
let send: ((text: string) => Promise<unknown>) | null = null;

function peerCount(): number {
  return room === null ? 0 : Object.keys(room.getPeers()).length;
}

async function join(roomId: string, maxUsers: number | undefined): Promise<void> {
  const relayUrl = await signalUrl(EDGE_ORIGIN, APP_ID, roomId);
  const next = joinRoom(
    {
      appId: APP_ID,
      identity: "none",
      use: [scale({ maxDirectPeers: 9 })],
      relayConfig: { urls: [relayUrl] },
      ...(maxUsers === undefined ? {} : { maxUsers }),
    },
    roomId,
  );
  room = next;
  next.onError((error) => {
    const mapped = fromRoomError(error);
    errors.push({ code: mapped.code, category: mapped.category, message: mapped.message });
  });
  const chat = next.makeAction("chat");
  chat.onMessage((text) => {
    messages.push(String(text));
  });
  send = (text) => chat.send(text);
}

window.roomFull = {
  ready: true,
  join,
  send: (text: string) => (send === null ? Promise.reject(new Error("not joined")) : send(text)),
  state: () => ({ peers: peerCount(), messages: [...messages], errors: [...errors] }),
  leave: async () => {
    await room?.leave();
    room = null;
    send = null;
  },
};

declare global {
  interface Window {
    roomFull: {
      ready: boolean;
      join: (roomId: string, maxUsers: number | undefined) => Promise<void>;
      send: (text: string) => Promise<unknown>;
      state: () => { peers: number; messages: string[]; errors: ErrorReport[] };
      leave: () => Promise<void>;
    };
  }
}
