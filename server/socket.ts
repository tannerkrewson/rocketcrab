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

export default (io: Server, rocketcrab: RocketCrab): void => {
    io.on("connection", (socket) => {
        socket.on("join-party", onJoinParty(socket, rocketcrab));
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
        socket.emit("invalid-party", { code });
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

    socket.on("disconnect", () => {
        removePlayer(player, party);
        deletePartyIfEmpty(party, partyList);
        sendStateToAll(party);
    });

    socket.on("name", (name) => {
        setName(name, player, playerList);
        sendStateToAll(party);
    });

    socket.on("game-select", (gameId) => {
        if (!player.isHost) return;

        setGame(gameId, party);
        sendStateToAll(party);
    });

    socket.on("game-start", () => {
        if (!player.isHost) return;

        startGame(party);
        sendStateToAll(party);
    });

    socket.on("game-exit", () => {
        if (!player.isHost) return;

        exitGame(party);
        sendStateToAll(party);
    });
};
