import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PartyCodeForm } from "../components/party/PartyCodeForm";
import { PartyShellHeader } from "../components/party/PartyShellHeader";
import { buttonStyles } from "../components/ui/Button";

/** `/join`: type a friend's party code. Home and external games link here. */
export const Route = createFileRoute("/join")({
  component: JoinPage,
});

function JoinPage() {
  return (
    <section className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 text-center">
      <PartyShellHeader />
      <div className="glass flex w-full flex-col gap-4 rounded-2xl p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-black">Join a party</h1>
          <p className="text-sm text-foreground/70">
            Enter the code on your friend&apos;s screen, or scan their QR code or open their invite
            link instead.
          </p>
        </div>
        <PartyCodeForm
          backAction={
            <Link to="/" className={buttonStyles("tertiary", "lg")}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Link>
          }
        />
      </div>
    </section>
  );
}
