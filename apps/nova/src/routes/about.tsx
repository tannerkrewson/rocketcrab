import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { BrandHeader } from "../components/layout/BrandHeader";
import { buttonStyles } from "../components/ui/Button";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

const LINK = "font-semibold text-foreground underline underline-offset-4";

function AboutPage() {
  return (
    <div className="flex flex-col gap-6">
      <BrandHeader />
      <Link to="/" className={buttonStyles("default", "md", "self-start", true)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Link>
      {/* A short letter from the author. */}
      <article className="glass mx-auto flex w-full max-w-xl flex-col gap-4 rounded-2xl p-6 text-lg leading-relaxed text-foreground/85 sm:p-8">
        <h1 className="text-3xl font-black text-foreground">About</h1>
        <p>
          I created Rocketcrab in 2020 as a unique way for friends to play many different games with
          each other easily. I mostly abandoned it since then, but I kept paying the monthly bill
          for the server because people kept playing!
        </p>
        <p>
          In 2026, powerful AI coding tools allowed me to rebuild Rocketcrab into{" "}
          <span className="font-bold text-nova-text">Rocketcrab Nova</span>, which allows you to
          create your own games and play them with your friends instantly! In addition, Rocketcrab
          was rewritten using{" "}
          <a href="https://trystero.dev/" className={LINK}>
            Trystero
          </a>{" "}
          peer-to-peer networking and does not require a server anymore! The new rocketcrab remains
          free and{" "}
          <a href="https://github.com/tannerkrewson/rocketcrab" className={LINK}>
            open source
          </a>{" "}
          under the MIT license.
        </p>
        <p className="font-bold text-foreground">
          Enjoy!
          <br />
          -Tanner
        </p>
        <p className="border-t border-separator pt-4 text-base text-foreground/70">
          PS Email me at{" "}
          <a href="mailto:tannerkrewson@gmail.com" className={LINK}>
            tannerkrewson@gmail.com
          </a>{" "}
          if you have any issues!
        </p>
      </article>
    </div>
  );
}
