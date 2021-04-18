import {
    addPlayer,
    sendStateToAll,
    removePlayer,
    deletePartyIfEmpty,
    setName,
    setGame,
    startGame,
    exitGame,
    getPartyByCode,
    reconnectToParty,
    getFinderState,
    sendFinderStateToAll,
    addChatMessage,
    kickPlayer,
} from "./rocketcrab";
import type {
    JoinPartyResponse,
    Player,
    Party,
    RocketCrab,
} from "../types/types";
import type { Server, Socket } from "socket.io";
import { SocketEvent } from "../types/enums";
import { getModeFromHost } from "../utils/utils";

export default (io: Server, rocketcrab: RocketCrab): void => {
    io.on("connection", (socket) => {
        socket.on(SocketEvent.JOIN_PARTY, onJoinParty(socket, rocketcrab));
        socket.on(
            SocketEvent.FINDER_SUBSCRIBE,
            onFinderSubscribe(socket, rocketcrab)
        );
    });
};

const onJoinParty = (socket: Socket, rocketcrab: RocketCrab) => ({
    code,
    lastPartyState,
    reconnecting,
}: JoinPartyResponse) => {
    const { partyList } = rocketcrab;

    const party = reconnecting
        ? reconnectToParty(lastPartyState, rocketcrab)
        : getPartyByCode(code, partyList);

    const isPlayerBanned = party?.bannedIPs?.find(
        (ip) => socket?.handshake?.address === ip
    );

    const userMode = getModeFromHost(socket?.handshake?.headers?.host);
    const modesMatch = userMode === party?.mode;

    if (party && !isPlayerBanned && modesMatch) {
        const { id, name } = lastPartyState?.me || {};
        const player = addPlayer(name, socket, party, id);

        attachPartyListenersToPlayer(player, party, rocketcrab);
        sendStateToAll(party, rocketcrab, { enableFinderCheck: true });
    } else {
        socket.emit(SocketEvent.INVALID_PARTY, { code });
    }
};

const attachPartyListenersToPlayer = (
    player: Player,
    party: Party,
    rocketcrab: RocketCrab
) => {
    const { partyList } = rocketcrab;
    const { socket } = player;
    const { code, playerList } = party;

    socket.join(code); // https://socket.io/docs/rooms/

    socket.on(SocketEvent.DISCONNECT, () => {
        removePlayer(player, party);
        deletePartyIfEmpty(party, partyList);
        sendStateToAll(party, rocketcrab, { enableFinderCheck: true });
    });

    socket.on(SocketEvent.NAME, (name) => {
        setName(name, player, playerList);
        sendStateToAll(party, rocketcrab, { enableFinderCheck: player.isHost });
    });

    socket.on(SocketEvent.GAME_SELECT, (gameId) => {
        if (!player.isHost) return;

        setGame(gameId, party);
        sendStateToAll(party, rocketcrab, { enableFinderCheck: true });
    });

    socket.on(SocketEvent.GAME_START, (gameId) => {
        if (!player.isHost) return;

        if (gameId) {
            setGame(gameId, party);
        }

        startGame(party, rocketcrab);
        // startGame does its own sendStateToAlls
    });

    socket.on(SocketEvent.GAME_EXIT, () => {
        if (!player.isHost) return;

        exitGame(party);
        sendStateToAll(party, rocketcrab, { enableFinderCheck: true });
    });

    socket.on(SocketEvent.CHAT_MESSAGE, (message) => {
        const isMessageValid = addChatMessage(message, player, party);
        if (isMessageValid) {
            sendStateToAll(party, rocketcrab, { enableFinderCheck: false });
        }
    });

    socket.on(SocketEvent.KICK_PLAYER, ({ playerId, isBan }) => {
        if (!player.isHost) return;

        kickPlayer(playerId, isBan, party);
        sendStateToAll(party, rocketcrab, { enableFinderCheck: true });
    });

    socket.on(SocketEvent.SET_IS_PUBLIC, (proposedIsPublic) => {
        if (player.isHost && rocketcrab.isFinderActive) {
            party.isPublic = !!proposedIsPublic;
        }

        sendStateToAll(party, rocketcrab, { forceFinderUpdate: true });
    });
};

const onFinderSubscribe = (socket: Socket, rocketcrab: RocketCrab) => () => {
    socket.emit(SocketEvent.FINDER_UPDATE, getFinderState(rocketcrab));

    rocketcrab.finderSubscribers.push(socket);

    socket.on(SocketEvent.DISCONNECT, () => {
        rocketcrab.finderSubscribers = rocketcrab.finderSubscribers.filter(
            (s) => s !== socket
        );
        onFinderSubscriberUpdate(rocketcrab);
    });

    onFinderSubscriberUpdate(rocketcrab);
};

const onFinderSubscriberUpdate = (rocketcrab: RocketCrab) => {
    // this is to update the subscriber count. only do this when then finder is
    // not active, because when it is, there are many other events happening
    // that will also send the subscriber count.
    if (!rocketcrab.isFinderActive) {
        sendFinderStateToAll(rocketcrab);
    }
};
