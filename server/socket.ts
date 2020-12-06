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
    });
};

const onJoinParty = (socket: SocketIO.Socket, { partyList }: RocketCrab) => ({
    code,
    lastPartyState,
    reconnecting,
}: JoinPartyResponse) => {
    const party = reconnecting
        ? reconnectToParty(lastPartyState, partyList)
        : getPartyByCode(code, partyList);

    if (party) {
        const { id, name } = lastPartyState?.me || {};
        const player = addPlayer(name, socket, party, id);

        attachPartyListenersToPlayer(player, party, partyList);
        sendStateToAll(party);
    } else {
        socket.emit(SocketEvent.INVALID_PARTY, { code });
    }
};

const attachPartyListenersToPlayer = (
    player: Player,
    party: Party,
    partyList: Array<Party>
) => {
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

    socket.on(SocketEvent.GAME_START, () => {
        if (!player.isHost) return;

        startGame(party);
        sendStateToAll(party);
    });

    socket.on(SocketEvent.GAME_EXIT, () => {
        if (!player.isHost) return;

        exitGame(party);
        sendStateToAll(party);
    });
};
