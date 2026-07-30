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

const onJoinParty =
    (socket: Socket, rocketcrab: RocketCrab) =>
    ({ code, lastPartyState, reconnecting }: JoinPartyResponse) => {
        const { partyList } = rocketcrab;

        let party = getPartyByCode(code, partyList);

        if (!party && reconnecting) {
            party = reconnectToParty(lastPartyState, rocketcrab);
        }

        const isPlayerBanned = party?.bannedIPs?.find(
            (ip) => socket?.handshake?.address === ip,
        );

        const userMode = getModeFromHost(socket?.handshake?.headers?.host);
        const modesMatch = userMode === party?.mode;

        if (party && !isPlayerBanned && modesMatch) {
            const { id, name } = lastPartyState?.me || {};
            const player = addPlayer(name, socket, party, id);

            attachPartyListenersToPlayer(player, party, rocketcrab);
            sendStateToAll(party);
        } else {
            socket.emit(SocketEvent.INVALID_PARTY, { code });
        }
    };

const attachPartyListenersToPlayer = (
    player: Player,
    party: Party,
    rocketcrab: RocketCrab,
) => {
    const { partyList } = rocketcrab;
    const { socket } = player;
    const { code, playerList } = party;

    socket.join(code); // https://socket.io/docs/rooms/

    socket.on(SocketEvent.DISCONNECT, () => {
        removePlayer(player, party);
        deletePartyIfEmpty(party, partyList);
        sendStateToAll(party);
    });

    socket.on(SocketEvent.NAME, (name) => {
        setName(name, player, playerList);
        sendStateToAll(party);
    });

    socket.on(SocketEvent.GAME_SELECT, (gameId) => {
        if (!player.isHost) return;

        setGame(gameId, party);
        sendStateToAll(party);
    });

    socket.on(SocketEvent.GAME_START, (gameId) => {
        if (!player.isHost) return;

        if (gameId) {
            setGame(gameId, party);
        }

        startGame(party);
        // startGame does its own sendStateToAlls
    });

    socket.on(SocketEvent.GAME_EXIT, () => {
        if (!player.isHost) return;

        exitGame(party);
        sendStateToAll(party);
    });

    socket.on(SocketEvent.CHAT_MESSAGE, (message) => {
        const isMessageValid = addChatMessage(message, player, party);
        if (isMessageValid) {
            sendStateToAll(party);
        }
    });

    socket.on(SocketEvent.KICK_PLAYER, ({ playerId, isBan }) => {
        if (!player.isHost) return;

        kickPlayer(playerId, isBan, party);
        sendStateToAll(party);
    });

    socket.on(SocketEvent.SET_IS_PUBLIC, (proposedIsPublic) => {
        if (player.isHost) {
            party.isPublic = !!proposedIsPublic;
        }

        sendStateToAll(party);
    });
};

const s = (io: Server, rocketcrab: RocketCrab): void => {
    io.on("connection", (socket) => {
        socket.on(SocketEvent.JOIN_PARTY, onJoinParty(socket, rocketcrab));
    });
};

export default s;
