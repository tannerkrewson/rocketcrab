import { createFileRoute } from "@tanstack/react-router";
import { Card } from "../components/ui/Card";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

const flowSteps = [
  {
    title: "1. Copy the prompt",
    body: "Open Create and copy one master prompt into any AI chat service — the same prompt works everywhere.",
  },
  {
    title: "2. Answer a few questions",
    body: "The chatbot interviews you about rules, players, turns, controls, and style, then writes the whole game.",
  },
  {
    title: "3. Paste the game",
    body: "The chatbot returns one complete HTML document. Paste it into Nova and hit run.",
  },
  {
    title: "4. Test, save, play",
    body: "Try it with simulated players, save it in your browser, then start a party with a four-letter code.",
  },
];

function AboutPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-black">About Rocketcrab Nova</h1>
        <p className="text-base-content/70">
          Nova is a static, mobile-first way to create, test, save, and play user-generated
          multiplayer browser games.
        </p>
      </header>

      <section aria-labelledby="what-heading">
        <h2 id="what-heading" className="mb-3 text-xl font-black">
          What Nova is
        </h2>
        <Card>
          <p className="text-base-content/80">
            Nova doesn't generate games itself, and it doesn't run a server for you. You bring the
            game idea; an AI chatbot you already use writes the game as a single HTML file; Nova
            runs it in an isolated frame, lets you test it with simulated players, saves it in your
            browser, and connects real friends through a peer-to-peer party. No accounts, no
            hosting, no cloud save, no public catalog.
          </p>
        </Card>
      </section>

      <section aria-labelledby="flow-heading">
        <h2 id="flow-heading" className="mb-3 text-xl font-black">
          How the game-generation flow works
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {flowSteps.map((step) => (
            <Card key={step.title} title={step.title}>
              <p className="text-base-content/80">{step.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="safety-heading">
        <h2 id="safety-heading" className="mb-3 text-xl font-black">
          Safety notes
        </h2>
        <Card>
          <ul className="list-disc space-y-2 pl-5 text-base-content/80">
            <li>
              Game code is untrusted. It runs in a separate, isolated origin so it can't touch
              Nova's storage, your saved games, or this page's data.
            </li>
            <li>
              Games are saved only in your browser. Game source is never uploaded to Nova
              infrastructure.
            </li>
            <li>
              Parties are for friends. A four-letter code is a meeting place, not a lock: the person
              who created the party admits each player before the game is shared.
            </li>
            <li>
              Games can use the internet (CDNs, images, `fetch`), so only play games you trust, just
              like any website.
            </li>
            <li>
              Nova can't stop a game from being annoying or broken — but the exit control stays
              outside the game frame, so you can always leave.
            </li>
          </ul>
        </Card>
      </section>

      <section aria-labelledby="limits-heading">
        <h2 id="limits-heading" className="mb-3 text-xl font-black">
          What Nova doesn't do (yet)
        </h2>
        <Card>
          <ul className="list-disc space-y-2 pl-5 text-base-content/80">
            <li>No public game catalog or publishing.</li>
            <li>No accounts or cloud sync — clearing browser data removes games.</li>
            <li>No server-authoritative simulation or anti-cheat.</li>
            <li>No guarantee every network pair connects directly (peer-to-peer).</li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
