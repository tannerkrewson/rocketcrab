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
} from "./rocketcrab";
import type {
    JoinPartyResponse,
    Player,
    Party,
    RocketCrab,
} from "../types/types";
import type { Server } from "socket.io";
import { SocketEvent } from "../types/enums";

export default (io: Server, rocketcrab: RocketCrab): void => {
    io.on("connection", (socket) => {
        socket.on(SocketEvent.JOIN_PARTY, onJoinParty(socket, rocketcrab));
        socket.on(
            SocketEvent.FINDER_SUBSCRIBE,
            onFinderSubscribe(socket, rocketcrab)
        );
    });
};

const onJoinParty = (socket: SocketIO.Socket, rocketcrab: RocketCrab) => ({
    code,
    lastPartyState,
    reconnecting,
}: JoinPartyResponse) => {
    const { partyList } = rocketcrab;

    const party = reconnecting
        ? reconnectToParty(lastPartyState, partyList)
        : getPartyByCode(code, partyList);

    if (party) {
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

    socket.on(SocketEvent.GAME_START, () => {
        if (!player.isHost) return;

        startGame(party, rocketcrab);
        // startGame does its own sendStateToAlls
    });

    socket.on(SocketEvent.GAME_EXIT, () => {
        if (!player.isHost) return;

        exitGame(party);
        sendStateToAll(party, rocketcrab, { enableFinderCheck: true });
    });
};

const onFinderSubscribe = (
    socket: SocketIO.Socket,
    rocketcrab: RocketCrab
) => () => {
    socket.emit(SocketEvent.FINDER_UPDATE, getFinderState(rocketcrab));

    rocketcrab.finderSubscribers.push(socket);

    socket.on(SocketEvent.DISCONNECT, () => {
        rocketcrab.finderSubscribers = rocketcrab.finderSubscribers.filter(
            (s) => s !== socket
        );
    });
};
