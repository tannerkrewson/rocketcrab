import {
    getParty,
    addPlayer,
    sendStateToAll,
    removePlayer,
    deletePartyIfEmpty,
    setName,
    setGame,
    startGame,
    exitGame,
} from "./rocketcrab";
import { JoinPartyResponse, Player, Party, RocketCrab } from "../types/types";

export default (
    io: SocketIO.Server,
    { partyList }: RocketCrab
): SocketIO.Namespace =>
    io.on("connection", (socket) => {
        socket.on("join-party", ({ code, id, name }: JoinPartyResponse) => {
            const party = getParty(code, partyList);

            if (party) {
                const player = addPlayer(name, socket, party, id);

                attachPartyListenersToPlayer(player, party, partyList);
                sendStateToAll(party);
            } else {
                socket.emit("invalid-party", { code });
            }
        });
    });

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
