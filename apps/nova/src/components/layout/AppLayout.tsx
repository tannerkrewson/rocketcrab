import { Link, Outlet } from "@tanstack/react-router";
import { Home, Info, Library, PlusCircle, Rocket, Users } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "../../lib/cn";

interface NavItem {
  to: "/" | "/build" | "/browse" | "/join" | "/about";
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  exact?: boolean;
}

const navItems: NavItem[] = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/build", label: "Build", icon: PlusCircle },
  { to: "/browse", label: "Games", icon: Library },
  { to: "/join", label: "Join", icon: Users },
  { to: "/about", label: "About", icon: Info },
];

function BrandLink() {
  return (
    <Link to="/" className="flex items-center gap-2 px-1 text-lg font-black tracking-tight">
      <Rocket className="h-6 w-6 text-primary" aria-hidden="true" />
      <span>
        Rocketcrab <span className="text-primary">Nova</span>
      </span>
    </Link>
  );
}

/**
 * App-wide shell: top bar (brand + desktop links), page content, and a
 * thumb-friendly bottom navigation on mobile.
 */
export function AppLayout() {
  return (
    <div className="min-h-screen bg-base-200 text-base-content">
      <header className="sticky top-0 z-40 pt-safe">
        <div className="navbar mx-auto max-w-5xl rounded-b-box border-2 border-t-0 border-base-300 bg-base-100 px-3 shadow-sm">
          <div className="navbar-start">
            <BrandLink />
          </div>
          <nav className="navbar-center hidden gap-1 md:flex" aria-label="Primary">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact }}
                activeProps={{ className: "btn-primary" }}
                inactiveProps={{ className: "btn-ghost" }}
                className="btn min-h-11 px-4 text-sm font-bold"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="navbar-end hidden md:flex" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 md:pb-12">
        <Outlet />
      </main>

      <nav
        className="btm-nav btm-nav-lg z-40 border-t-2 border-base-300 bg-base-100 pb-safe md:hidden"
        aria-label="Primary mobile"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact }}
              activeProps={{ className: "active text-primary" }}
              className={cn("flex flex-col items-center gap-0.5 py-1 text-xs font-bold")}
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
