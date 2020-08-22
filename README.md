# 🚀🦀 rocketcrab

### Play now at [rocketcrab.com](https://rocketcrab.com/)

rocketcrab is a lobby service and launcher for mobile web party games.

## 🚀🦀 for developers

Rocketcrab makes it easy for players to discover your game, and easily switch to and from your game without having to manually open a different website, or enter a new game code. Integrating your game with rocketcrab should be a simple process, but please let us know by opening an issue or joining our Discord if there is any way it could be better!

Games are added to rocketcrab via config files located [here](https://github.com/tannerkrewson/rocketcrab/tree/master/config/games). By looking at the config files of other games, you might be able to understand how other games implement rocketcrab, and how you might integrate rocketcrab into your game. Here's what you need to know:

### Step 1: Ensuring compatability

Rocketcrab works by opening your game in an `iframe` on all of the players' devices. At minimum, for your game to work with rocketcrab, there must be:

-   A way for rocketcrab to generate a new lobby/room via either:
    -   an API that rocketcrab can hit (eg. `https://yourgame.com/api/creategame`, which returns the generated game code, like `abcd`)
    -   generating a random id that your game will accept as a valid room code
-   A way to construct a link to join a game using that game code (eg. `https://yourgame.com/abcd` will be opened on every player's browser, resulting in them all being in the same game together)

That's it! Many existing games already offer these, and can work with rocketcrab without any changes! But, to make the experience of playing your game with rocketcrab even better, you may need to make a few minor changes, explained in step 3.

### Step 2: Creating a config file

The config files, as mentioned above, should be fairly self explanatory. Feel free to use any of the existing config files as templates. The most important part, which will be explained here, is the `getJoinGameUrl` function. This function:

-   is `async`, which will allow you to use `await` to make `GET` or `POST` requests.
-   needs to return an object with these properties:
    -   `playerURL` (required) string of the url that should be opened in every player's `iframe`.
    -   `hostURL` (optional) string of a url to be opened only in the "host" player's `iframe`. If not provided, the `playerURL` will be used.
    -   `code` (optional) the code to be added to the `playerURL` as `code` (see step 3 for further explanation)

Here are three examples of different `getJoinGameUrl` functions:

-   For [Drawphone](https://github.com/tannerkrewson/rocketcrab/blob/a3f796af7f6b70100b1dcf9ab141d73fea41e049/config/games/drawphone.ts#L18-L25), a new game can be generated with a `POST` request to the `/new`, which will return a game code. In it's `getJoinGameUrl` function, the `/new` endpoint is called, and the resulting game code is returned in the `code` property, which will add the code as a query param called `code` to the `playerURL` that is opened in each player's `iframe`.
-   For [Spyfall](https://github.com/tannerkrewson/rocketcrab/blob/a3f796af7f6b70100b1dcf9ab141d73fea41e049/config/games/spyfall.ts#L18-L24), a new game can be generated in the exact same way as Drawphone. But, game links are required to take the format `spyfall.tannerkrewson.com/abcd`, and not `drawphone.tannerkrewson.com/?code=abcd` like the above example. So, instead of returning the game code from `getJoinGameUrl` in the `code` property, the game code is directly appended to the `playerURL` before it is returned from `getJoinGameUrl`.
-   For [Just One](https://github.com/tannerkrewson/rocketcrab/blob/a3f796af7f6b70100b1dcf9ab141d73fea41e049/config/games/justone.ts#L14-L19), we can pick our own game code! So, instead of calling to some endpoint to get a game code like Drawphone and Spyfall, the `getJoinGameUrl` function can itself generate a code, and we cross our fingers and hope it's unique! 😂 The resulting `playerURL` will look something like this: `https://just1.herokuapp.com/room/rocketcrab-d5b30ccdd25855e5`.

### Step 3: The automatic query params

The `playerURL` returned from `getJoinGameUrl` is automatically appended with 3 or 4 query params. Four if a `code` is returned `getJoinGameUrl`, four if not. The resulting `playerURL` that is opened in every player's `iframe` will look something like this:

```
https://yourgame.com/?rocketcrab=true&name=Mary&ishost=true&code=abcd
```

-   `rocketcrab` will always be true, well, if you're using rocketcrab, that is! 😂 You can use this to put your game into a "rocketcrab" mode. Here are some ideas for how this could be helpful:
    -   Rocketcrab itself has it's own game code system, so if your game prominentely displays its own game code, your players may be confused. If `rocketcrab=true`, you should hide any UI in your game that shows the game code!
    -   You should also hide any "Play on 🚀🦀" buttons, because if `rocketcrab=true`, they're already playing with on rocketcrab! 😂
-   `name` is a string of the name that each player has entered into rocketcrab. Use this instead of asking for your players' names a second time!
-   `ishost` is `true` for the one player that is the host of the rocketcrab lobby, and `false` for all other players. A few caveats:
    -   We included this in case some one needed it, but implementing this in your game could allow any player that knows about it to make themselves host, especially outside of rocketcrab, so we don't recommend it.
    -   In Drawphone, for example, the first player who joins a lobby is made the host. So, rocketcrab will load the host's `iframe` first, and will wait a few seconds before opening the `iframe` of the rest of the players. This is not a guaranteed solution, as the `iframe` API does not allow rocketcrab to know when its page has loaded.
-   `code` is the same `string` that is returned from `getJoinGameUrl`'s `code` property. If that `code` property is not provided, this query param will not be included.

### Step 4: 🚀🦀 for your existing players

If your game already has a player base, our goal is to make rocketcrab their preferred way to play! So, we will want to make the process of discovering and jumping into a rocketcrab lobby from your game's existing lobby as painless as possible!

## 🚀🦀 Behind the scenes

This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app) using the [`with-typescript-eslint-jest`](https://github.com/vercel/next.js/tree/v9.4.4/examples/with-typescript-eslint-jest) template, which includes:

-   [Typescript](https://www.typescriptlang.org/)
-   Linting with [ESLint](https://eslint.org/)
-   Formatting with [Prettier](https://prettier.io/)
-   Linting, typechecking and formatting on by default using [`husky`](https://github.com/typicode/husky) for commit hooks
-   Testing with [Jest](https://jestjs.io/) and [`react-testing-library`](https://testing-library.com/docs/react-testing-library/intro)

### Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.js`. The page auto-updates as you edit the file.

### Learn More

To learn more about Next.js, take a look at the following resources:

-   [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
-   [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!
