import { ServerGame } from "../../types/types";

const game: ServerGame = {
    // author's initials, hypen, game name in lowercase with no spaces or hyphens
    id: "jd-coolgame", // required

    name: "Cool Game Online", // required
    author: "John Doe", // required

    // please include this if your game is based off another game
    basedOn: {
        game: "Cool Game",
        author: "Don Joe", // optional

        // if possible, make this a link to buy the game from the official manufacturer
        link: "https://link.com", // optional
    }, // optional

    // TODO: this is a work in progress. There will probably end up being a description property,
    //       a rules property, and a screenshots property. For now, just a short sentence or two
    //       works for this.
    description: "A really, really, really cool game.", // optional

    // these are just for showing a link in the game detail box, not for the iframe
    displayUrlText: "coolgame.com", // required
    displayUrlHref: "https://coolgameonline.com", // required

    // see categories.json, feel free to add a category if you feel one is missing!
    category: ["medium", "drawing"], // required
    /* Pick one of:
        "easy" => Very Simple (players can successfully play the game and have fun without knowing any rules)
        "medium" => Easy to explain
        "hard" => Know the rules firsts
    */

    // this is just for show. make this the recommended number of players or something
    players: "4-9", // optional

    // if there is explicit content in the game that can't be turned off, set this as true
    familyFriendly: false, // required

    // you can add a min and/or max players if you would like disable the "Start Game" button
    // if the number of players in the rocketcrab lobby is not within range. this can be different
    // than the "players" property.
    minPlayers: 1, // optional. if you do use it, make this 1 or more
    maxPlayers: 6, // optional. if you do use it, make this 1 or more

    // see https://github.com/tannerkrewson/rocketcrab#step-2-creating-a-config-file
    // note that this will be running on the rocketcrab server, and will run once per lobby, not per player.
    getJoinGameUrl: async () => {
        // this is an example of one way it could be done. you could put any code here to do what you need to do!
        // check other config files for more exmaples.

        // this makes a get request
        const res = await fetch("https://coolgameonline.com/api/new");
        const jsonRes = await res.json();

        return {
            playerURL: "https://coolgameonline.com/room/" + jsonRes.code, // required
            hostURL:
                "https://coolgameonline.com/room/" + jsonRes.code + "/host", // optional. if not used, rocketcrab host will use playerURL
            code: jsonRes, // optional. will be appended to playerURL and hostURL as a query param. so like ?code=abcd
        };
    }, // required
};

export default game;
