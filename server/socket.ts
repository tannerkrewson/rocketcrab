import {
    getLobby,
    addPlayer,
    sendStateToAll,
    removePlayer,
    deleteLobbyIfEmpty,
    setName,
} from "./rocketcrab";
import { JoinLobbyResponse, Player, Lobby } from "../types/types";

export default (io, { lobbyList }) =>
    io.on("connection", (socket) => {
        socket.on("join-lobby", ({ code, name }: JoinLobbyResponse) => {
            const lobby = getLobby(code, lobbyList);
            if (lobby) {
                const player = { name, socket };
                addPlayer(player, lobby.playerList);

                attachLobbyListenersToPlayer(player, lobby, lobbyList);
                sendStateToAll(lobby);
            } else {
                socket.emit("invalid-lobby", { code });
            }
        });
    });

const attachLobbyListenersToPlayer = (
    player: Player,
    lobby: Lobby,
    lobbyList: Array<Lobby>
) => {
    const { socket } = player;
    const { code, playerList } = lobby;

    socket.join(code); // https://socket.io/docs/rooms/

    socket.on("disconnect", () => {
        removePlayer(player, playerList);
        deleteLobbyIfEmpty(lobby, lobbyList);
        sendStateToAll(lobby);
    });

    socket.on("name", (name) => {
        setName(name, player, playerList);
        sendStateToAll(lobby);
    });
};
