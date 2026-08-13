import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { ThemeSelector } from "./ThemeSelector";

interface FooterLink {
  to: "/" | "/build" | "/browse" | "/library" | "/join" | "/about";
  label: string;
}

/** Every non-party page stays reachable from the shared footer (7.34). */
const footerLinks: FooterLink[] = [
  { to: "/", label: "Home" },
  { to: "/build", label: "Build" },
  { to: "/browse", label: "Games" },
  { to: "/library", label: "Library" },
  { to: "/join", label: "Join" },
  { to: "/about", label: "About" },
];

/**
 * App-wide shell (7.34/7.36): a single consistent page column plus a minimal
 * shared footer (site links + theme toggle). The navbar and mobile bottom
 * nav are gone; every non-party page inherits the footer automatically.
 * Party routes (/join, /party, /play) render their own classic party-shell
 * chrome, so the app footer is skipped there (7.22).
 */
export function AppLayout() {
  const location = useLocation();
  const isPartyRoute =
    location.pathname === "/join" ||
    location.pathname === "/party" ||
    location.pathname === "/play";

  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-12 pt-6">
        <Outlet />
      </main>

      {isPartyRoute ? null : (
        <footer className="border-t-2 border-base-300 bg-base-100">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
            <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
              {footerLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="text-sm font-bold text-base-content/70 transition-colors hover:text-base-content"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-base-content/50">
                Rocketcrab Nova — party games for phones
              </p>
              <ThemeSelector />
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
