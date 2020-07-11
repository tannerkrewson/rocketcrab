import { getLobby, addPlayer, sendUpdatedLobby } from "./rocketcrab";
import { JoinLobbyResponse } from "../types/types";

export default (io, rocketCrab) =>
    io.on("connection", (socket) => {
        socket.on("join-lobby", ({ code, name }: JoinLobbyResponse) => {
            const theLobby = getLobby(code, rocketCrab);
            if (theLobby) {
                addPlayer({ name, socket }, theLobby);

                // https://socket.io/docs/rooms/
                socket.join(code);

                sendUpdatedLobby(theLobby, io);
            } else {
                socket.emit("invalid-lobby", { code });
            }
        });
    });
