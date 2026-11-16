import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { BrandHeader } from "../components/layout/BrandHeader";
import { buttonStyles } from "../components/ui/Button";
import { PagePlaceholder } from "../components/ui/PagePlaceholder";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

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
