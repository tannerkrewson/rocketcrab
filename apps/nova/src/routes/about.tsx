import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { BrandHeader } from "../components/layout/BrandHeader";
import { buttonStyles } from "../components/ui/Button";
import { PagePlaceholder } from "../components/ui/PagePlaceholder";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

/**
 * About page placeholder (rocketcrab-9fv.7.41 / 2t1.1): the previous "What
 * Nova is" copy, generation-flow steps, safety notes, and "What Nova doesn't
 * do (yet)" list were all removed in favor of a simple coming-soon message.
 * The brand row (rocketcrab.com) stays visible and one outline "back"
 * button returns home (the shared treatment used across the homepage
 * sub-pages).
 */
function AboutPage() {
  return (
    <div className="flex flex-col gap-6">
      <BrandHeader />
      <Link to="/" className={buttonStyles("default", "md", "self-start", true)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        back
      </Link>
      <PagePlaceholder
        title="Coming soon"
        description="This page is under construction. Check back later for more about Rocketcrab Nova."
      />
    </div>
  );
}
