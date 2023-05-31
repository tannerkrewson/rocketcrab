import { ServerGame } from "../../types/types";
import { postJson, newPromiseWebSocket } from "../../utils/utils";

const game: ServerGame = {
    id: "liesgame",
    name: "Lies Game",
    author: "Jeff Rubin",
    description:
        "It’s a game you play with your friends where you make up believable lies, then see if you can get your friends to believe them.",
    displayUrlText: "liesgame.com",
    displayUrlHref: "https://liesgame.com/",
    category: ["medium"],
    players: "2-8",
    familyFriendly: true,
    getJoinGameUrl: async () => {
        const {
            idToken,
            localId,
        } = await postJson(
            "https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=AIzaSyAg9jt0OsDMzw8LfC0o4qLevdmjGQjP9d4",
            { returnSecureToken: true }
        );

        const ws = newPromiseWebSocket(
            "wss://believable-lies.firebaseio.com/.ws?v=5"
        );
        await ws.onOpen();
        ws.send(
            '{"t":"d","d":{"r":2,"a":"auth","b":{"cred":"' + idToken + '"}}}'
        );
        ws.send(
            '{"t":"d","d":{"r":3,"a":"m","b":{"p":"/prod/users/' +
                localId +
                '","d":{"online":true,"lastOnlineAt":{".sv":"timestamp"}}}}}'
        );
        ws.send(
            '{"t":"d","d":{"r":4,"a":"om","b":{"p":"/prod/users/' +
                localId +
                '","d":{"online":null,"lastOnlineAt":{".sv":"timestamp"}}}}}'
        );

        await ws.onMessage();

        const res = await fetch(
            "https://us-central1-believable-lies.cloudfunctions.net/prodGame",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    authorization: "Bearer " + idToken,
                },
                body: '{"data":{"op":"createRoom"}}',
            }
        ).then((res) => res.json());

        const {
            result: { roomCode },
        } = res;

        return {
            playerURL: "https://liesgame.com/game/" + roomCode,
        };
    },
};

export default game;
