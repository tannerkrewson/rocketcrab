import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../components/ui/PagePlaceholder";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

/**
 * About page placeholder (rocketcrab-9fv.7.41): the previous "What Nova is"
 * copy, generation-flow steps, safety notes, and "What Nova doesn't do (yet)"
 * list were all removed in favor of a simple coming-soon message.
 */
function AboutPage() {
  return (
    <PagePlaceholder
      title="Coming soon"
      description="This page is under construction. Check back later for more about Rocketcrab Nova."
    />
  );
}
