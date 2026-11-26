# Porting a game to a hosted Nova game

Read [nova-api-reference.md](../prompt/nova-api-reference.md) first; it is the
API and the rules every Nova game follows. This file covers only what is
specific to porting an existing multiplayer web game (usually an iframe
game with its own server) and listing it in Nova's catalog.

## Porting

- The game server goes away. Its authoritative logic becomes
  `createInitialState`, `actions` and, if anything moves on its own, `tick`.
  Its messages from clients become actions or controls; its broadcasts
  become `nova.state.onChange`; its join, leave and reconnect handling
  becomes `playerJoined` and `playerLeft`. Server-only secrets (hands, roles)
  become `selectView`.
- Delete room codes, lobbies, join and name screens, sockets and reconnect
  logic: the Nova party does all of that. Players and names come from
  `nova.players`.
- Keep the game's look, rules and client rendering.

## Hosting

- Serve one HTML file, at most 2 MiB, from any static HTTPS host that sends
  `Access-Control-Allow-Origin: *` (GitHub Pages does). A build step is fine
  if it outputs a single file with scripts and styles inlined.
- The party host downloads the file when the game is picked and sends that
  copy to everyone, so a deploy never splits a party across versions.
- The file is written into a frame on Nova's runtime origin, so relative URLs
  do not resolve to your host: inline small assets and give every other one
  an absolute URL.
- Don't load a Nova SDK; the runtime provides `window.nova`. The game must
  call `nova.defineGame` within 10 seconds of loading.

## Testing and listing

1. Paste the HTML into the editor (`/editor`) and play it in the test arena.
2. Add an entry to `NOVA_GAMES` in [nova-games.ts](./nova-games.ts) with
   `play: { kind: "nova", url: "https://…" }`; the listing fields are
   `GameListing` in [types.ts](./types.ts). The site's CSP picks up the URL's
   origin and any `pictures` origins automatically.
3. Run `npm run dev` and start the game from a party.
