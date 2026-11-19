export const AUTHOR_URL = "https://tannerkrewson.com";
export const GITHUB_URL = "https://github.com/tannerkrewson/rocketcrab";

const LINK =
  "font-semibold text-foreground/80 underline-offset-4 transition-colors hover:text-foreground hover:underline";

/** Credit line centered at the bottom of every page. */
export function SiteFooter() {
  return (
    <footer className="relative z-10 flex flex-col items-center gap-1 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-center text-sm text-foreground/55">
      <p>
        rocketcrab by{" "}
        <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
          Tanner Krewson
        </a>
      </p>
      <p>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
          View on GitHub
        </a>
      </p>
    </footer>
  );
}
