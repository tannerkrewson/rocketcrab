import { getLobby, addPlayer, sendUpdatedLobby } from "./rocketcrab";
import { JoinLobbyResponse } from "../types/types";

export default (io, { lobbyList }) =>
    io.on("connection", (socket) => {
        socket.on("join-lobby", ({ code, name }: JoinLobbyResponse) => {
            const theLobby = getLobby(code, lobbyList);
            if (theLobby) {
                addPlayer({ name, socket }, theLobby.playerList);

                // https://socket.io/docs/rooms/
                socket.join(code);

                sendUpdatedLobby(theLobby, io);
            } else {
                socket.emit("invalid-lobby", { code });
            }
        });
    });
