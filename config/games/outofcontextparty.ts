import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";

const gameTemplate = (
    game: string,
    {
        name,
        description,
        basedOn,
        category,
        players,
        minPlayers,
        familyFriendly,
        pictures,
    }: Partial<ServerGame>
): ServerGame => ({
    id: "ooc-" + game,
    name: name,
    author: "Isaac Hirschfeld",
    basedOn,
    description,
    displayUrlText: "outofcontext.party",
    displayUrlHref: "https://www.outofcontext.party/",
    minPlayers,
    maxPlayers: 255,
    category,
    players,
    familyFriendly,
    pictures,
    connectToGame: async () => {
        const origin = "https://outofcontext.party"; // "http://localhost:8080"; // (dev)
        const { code } = await postJson(origin + "/api/v1/rocketcrab", {
            game,
            version: 1,
        });
        return {
            player: { url: `${origin}/lobby/${code}` },
        };
    },
});

const games: Array<ServerGame> = [
    gameTemplate("story", {
        name: "Raconteur",
        description: `Collaborate in writing stories one line at a time with
            minimal context.

            Raconteur is inspired by improv-type games where players
            contribute to a story one sentence or one word at a time.
            The idea is to create unique stories from a train of thought
            going who knows where. Continuity is held only by the last line
            in the story, so writing with ambiguity allows for more
            interesting stories.`,
        basedOn: {
            game: "Consequences, FoldingStory",
            link: "https://en.wikipedia.org/wiki/Consequences_(game)",
        },
        category: ["writing", "easy"],
        minPlayers: 2,
        players: "2+",
        familyFriendly: true,
        pictures: [
            "https://i.imgur.com/d3qNPi4.jpg",
            "https://i.imgur.com/yd8klf4.jpg",
            "https://i.imgur.com/gyCBqMh.jpg",
        ],
    }),
    gameTemplate("redacted", {
        name: "Redacted",
        description: `Collaborate in writing, tampering, and repairing
            stories one line at a time.

            Redacted is an extension upon Raconteur. Players still
            contribute to a story, however now players are able to interact
            with the lines other players have written. This game is meant to
            be played after a familiarity with no context line-by-line
            stories is established.`,
        basedOn: null,
        category: ["writing", "medium"],
        minPlayers: 4,
        players: "4+",
        familyFriendly: true,
        pictures: [
            "https://i.imgur.com/n4QYeLp.jpg",
            "https://i.imgur.com/IQ6DAhF.jpg",
            "https://i.imgur.com/urUahk6.jpg",
            "https://i.imgur.com/QSX70Nv.jpg",
            "https://i.imgur.com/vaIJQwM.jpg",
        ],
    }),
    gameTemplate("recipe", {
        name: "Hodgepodge",
        description: `Collaborate in splicing together recipes for anything.

            Hodgepodge is fairly complicated in the sense that there is not a
            single streamlined direction for each instruction set. Players
            submit steps in a recipe following a theme, ingredients without
            any context, and potential hazards without context. This mixture
            of randomness and context tends to be awfully delicious.`,
        basedOn: null,
        category: ["writing", "medium"],
        minPlayers: 2,
        players: "2+",
        familyFriendly: true,
        pictures: [
            "https://i.imgur.com/IAC751C.jpg",
            "https://i.imgur.com/BvdwE7v.jpg",
            "https://i.imgur.com/Mezk17h.jpg",
            "https://i.imgur.com/lkD8Xbf.jpg",
            "https://i.imgur.com/a8jCj5t.jpg",
        ],
    }),
];

export default games;
