import { ServerGame } from "../../types/types";
import { RocketcrabMode } from "../../types/enums";

// PLEASE REMOVE ALL COMMENTS AFTER COPYING THIS TEMPLATE
// (you can add your own comments tho if you like :D )

// you can name this config file whatever you like; doesn't have to match the id.
// any config files in this folder (besides ones that start with _) will automatically
// be picked up

const game: ServerGame = {
    id: "coolgame", // required
    name: "Cool Game Online", // required
    author: "John Doe", // required

    // please include this if your game is based off another game
    basedOn: {
        game: "Cool Game",
        author: "Don Joe", // optional

        // if possible, make this a link to buy the game from the official manufacturer
        link: "https://link.com", // optional

        // used for generating links to/from BoardGameGeek
        bggId: 123456789, // optional
    }, // optional

    // The description should explain why someone should play your game!
    // It can be a few sentences, or a few paragraphs!
    // Don't add the rules here.
    description: "A really, really, really cool game.", // optional

    // these are just for showing a link in the game detail box, not for the iframe
    displayUrlText: "coolgame.com", // required
    displayUrlHref: "https://coolgameonline.com", // required

    donationUrlText: "Support John on Patreon!", // optional
    donationUrlHref: "https://www.patreon.gov/johndoe", // optional

    // the name of the markdown file of the rules for this game in the /config/guides directory
    guideId: "coolgame", // optional

    // a link to the rule book or a guide for your game.
    // if a link to a website is provided, it will be displayed in an iframe.
    guideUrl: "https://coolgameonline.com/rules", // optional

    // only include a guideId, a guideUrl, or neither; not both.

    // links to screenshots of your game
    pictures: ["https://i.imgur.com/abcd.png", "https://i.imgur.com/efgh.png"], // optional

    // see categories.json, feel free to add a category if you feel one is missing!
    category: ["medium", "drawing"], // required
    /* Pick one of:
        "easy" => Very Simple (players can successfully play the game and have fun without knowing any rules)
        "medium" => Easy to explain
        "hard" => Know the rules firsts
    */

    // this is just for show. make this the recommended number of players or something
    players: "4-9", // optional

    // if there is explicit content in the game that can't be turned off,
    // remove the KIDS enum from the array. this will prevent the game from
    // being shown on kids.rocketcrab.com
    showOn: [RocketcrabMode.MAIN, RocketcrabMode.KIDS], // required

    // you can add a min and/or max players if you would like disable the "Start Game" button
    // if the number of players in the rocketcrab party is not within range. this can be different
    // than the "players" property.
    // THIS IS CURRENTLY NOT IMPLEMENTED
    minPlayers: 1, // optional. if you do use it, make this 1 or more
    maxPlayers: 6, // optional. if you do use it, make this 1 or more

    // see https://github.com/tannerkrewson/rocketcrab#step-2-creating-a-config-file
    // note that this will be running on the rocketcrab server, and will run once per party, not per player.
    // this function will be ran in a try catch, so no need to worry about crashing the server! 😆
    connectToGame: async () => {
        // this is an example of one way it could be done. you could put any code here to do what you need to do!
        // check other config files for more exmaples.

        // this makes a get request
        const res = await fetch("https://coolgameonline.com/api/new");
        const jsonRes = await res.json();

        return {
            player: {
                url: "https://coolgameonline.com/room/" + jsonRes.code, // required

                /*
                    if you want to add (or replace!) the automatic query params 
                    (see the readme for a list of these), use customQueryParams!
                    
                    with the below customQueryParams, playerURL would look 
                    something like:
                    https://coolgameonline.com/room/abcd/?rocketcrab=haha&name=Mary&ishost=false&foo=bar&baz=qux

                    Note: Prefer to use the renameParams (detailed below) over 
                    customQueryParams if possible.
                */
                customQueryParams: {
                    foo: "bar",
                    baz: "qux",
                    rocketcrab: "haha", // this is an example of replacing an automatic query param
                }, // optional

                /*
                    query params will be appended to playerURL and hostURL 
                    automatically. a string provided to afterQueryParams will be 
                    appended after that!

                    with the below afterQueryParams, playerURL would look something 
                    like:
                    https://coolgameonline.com/room/abcd/?rocketcrab=true&name=Mary&ishost=false#foo
                */
                afterQueryParams: "#foo", // optional

                /*
                    NOTE: feel free to use both customQueryParams and afterQueryParams
                    together! afterQueryParams will be appended after the automatic
                    and custom query params.
                */
            }, // required

            /*
                If you want the host player to use a different url, 
                customQueryParams, and/or afterQueryParams, include this host 
                property!
                
                This property itself and everything in it is optional.

                If this host property or anything it contains is not included, 
                rocketcrab will use whatever was set in the above player 
                property for the host.
                
                If you want the host player to NOT have something that was 
                included in the player property, you will need to include it in 
                the host property and set it as blank or otherwise.
            */
            host: {
                url:
                    "https://coolgameonline.com/room/" + jsonRes.code + "/host", // optional. if not used, rocketcrab host will use playerURL
                customQueryParams: {}, // optional. see player property for details.
                afterQueryParams: "", // optional. see player property for details.
            }, // optional
        };
    }, // required

    /*
       By default, rocketcrab will automatically apply some params to playerURL 
       like so:

       https://yourgame.com/?rocketcrab=true&name=Mary&ishost=true

       If you need those values to have different key names, use renameParams.
       For example, the below renameParams will make the above URL look like 
       this instead:

       https://yourgame.com/?boosterfish=true&nickname=Mary&admin=true

       You don't need to include all of them; just the ones you need.

       If you want to replace the values of these properties and not just the
       names, use customQueryParams.
    */
    renameParams: {
        rocketcrab: "boosterfish",
        name: "nickname",
        ishost: "admin",
    }, // optional
};

export default game;
