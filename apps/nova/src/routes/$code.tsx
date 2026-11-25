import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { PartyCodeForm } from "../components/party/PartyCodeForm";
import { PartyAddressHeader } from "../components/party/PartyShellHeader";
import { buttonStyles } from "../components/ui/Button";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { primeTurnChallenge } from "../lib/party/turnstile";
import { handOffInvite } from "../lib/party/invite-import";
import { lookupPartyCode, normalizePartyCode } from "../lib/party/party-code";

/**
 * `rocketcrab.com/abcd`: look the party code up, then join on `/party` with
 * the secret handed over in memory. Static routes outrank this one, and any
 * path that isn't four letters is the 404 page.
 */
export const Route = createFileRoute("/$code")({
  beforeLoad: ({ params }) => {
    if (normalizePartyCode(params.code) === null) throw notFound();
  },
  component: PartyCodePage,
});

function PartyCodePage() {
  const code = normalizePartyCode(Route.useParams().code)!;
  return <PartyCodeJoin key={code} code={code} />;
}

function PartyCodeJoin({ code }: { code: string }) {
  const navigate = useNavigate();
  const lookup = useQuery({
    queryKey: ["party-code", code],
    queryFn: () => lookupPartyCode(code),
    retry: 1,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const secret = lookup.data;

  useEffect(() => {
    // Warm the TURN challenge while the lookup runs, as /party does.
    primeTurnChallenge();
  }, []);
  useEffect(() => {
    if (typeof secret !== "string") return;
    handOffInvite(secret);
    void navigate({ to: "/party", replace: true });
  }, [secret, navigate]);

  return (
    <div className="flex flex-col gap-4">
      <PartyAddressHeader code={code} />
      {lookup.isError ? (
        <ErrorPanel
          className="mx-auto w-full max-w-sm"
          title="Couldn't reach rocketcrab"
          message="Check your connection and try again."
          onRetry={() => void lookup.refetch()}
        />
      ) : secret === null ? (
        <section className="glass mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl p-6 text-center">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-black">No party has this code</h1>
            <p className="text-sm text-foreground/70">
              Check the code with your friend, or ask them for their invite link.
            </p>
          </div>
          <PartyCodeForm
            backAction={
              <Link to="/" className={buttonStyles("tertiary", "lg")}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Home
              </Link>
            }
          />
        </section>
      ) : (
        <LoadingState className="pt-14 sm:pt-20" label="Finding the party…" />
      )}
    </div>
  );
}
