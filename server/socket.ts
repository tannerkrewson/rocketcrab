import {
    getLobby,
    addPlayer,
    sendStateToAll,
    removePlayer,
    deleteLobbyIfEmpty,
    setName,
    setGame,
    startGame,
    exitGame,
} from "./rocketcrab";
import { JoinLobbyResponse, Player, Lobby, RocketCrab } from "../types/types";

export default (
    io: SocketIO.Server,
    { lobbyList }: RocketCrab
): SocketIO.Namespace =>
    io.on("connection", (socket) => {
        socket.on("join-lobby", ({ code, id, name }: JoinLobbyResponse) => {
            const lobby = getLobby(code, lobbyList);

            if (lobby) {
                const player = addPlayer(name, socket, lobby, id);

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
        removePlayer(player, lobby);
        deleteLobbyIfEmpty(lobby, lobbyList);
        sendStateToAll(lobby);
    });

    socket.on("name", (name) => {
        setName(name, player, playerList);
        sendStateToAll(lobby);
    });

    socket.on("game-select", (gameId) => {
        if (!player.isHost) return;

        setGame(gameId, lobby);
        sendStateToAll(lobby);
    });

    socket.on("game-start", () => {
        if (!player.isHost) return;

        startGame(lobby);
        sendStateToAll(lobby);
    });

    socket.on("game-exit", () => {
        if (!player.isHost) return;

        exitGame(lobby);
        sendStateToAll(lobby);
    });
};
