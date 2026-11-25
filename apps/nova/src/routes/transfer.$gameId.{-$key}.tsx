import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { PartyShellHeader } from "../components/party/PartyShellHeader";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { findCatalogGame } from "../lib/catalog";
import { handOffInvite } from "../lib/party/invite-import";
import { isTransferKey, transferParty } from "../lib/party/party-code";
import { primeTurnChallenge } from "../lib/party/turnstile";

/**
 * External games' "Start party" links (a public API since the legacy site):
 * `/transfer/<gameId>` starts a party with that game picked, and
 * `/transfer/<gameId>/<key>` gathers every player sent with the same key into
 * one party. `?name=` prefills the player's name.
 */
export const Route = createFileRoute("/transfer/$gameId/{-$key}")({
  validateSearch: (search: Record<string, unknown>): { name?: string } => ({
    name: typeof search.name === "string" ? search.name : undefined,
  }),
  beforeLoad: ({ params }) => {
    if (params.key !== undefined && !isTransferKey(params.key)) throw notFound();
  },
  component: TransferPage,
});

function TransferPage() {
  const { gameId, key } = Route.useParams();
  const { name } = Route.useSearch();
  const navigate = useNavigate();
  const listed = findCatalogGame(gameId);
  // Unknown games still get a party, as on the legacy site.
  const game = listed === undefined ? {} : { gameId: listed.id, title: listed.name };

  const transfer = useQuery({
    queryKey: ["transfer", key],
    queryFn: () => transferParty(key!),
    enabled: key !== undefined,
    retry: 1,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    primeTurnChallenge();
  }, []);
  useEffect(() => {
    if (key !== undefined && transfer.data === undefined) return;
    const party = transfer.data;
    if (party !== undefined) handOffInvite(party.secret, party.created);
    // Only the player who creates the party picks the game; the rest join it.
    void navigate({
      to: "/party",
      search: party === undefined || party.created ? { ...game, name } : { name },
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, transfer.data]);

  return (
    <div className="flex flex-col gap-4">
      <PartyShellHeader />
      {transfer.isError ? (
        <ErrorPanel
          className="mx-auto w-full max-w-sm"
          title="Couldn't reach rocketcrab"
          message="Check your connection and try again."
          onRetry={() => void transfer.refetch()}
        />
      ) : (
        <LoadingState className="pt-14 sm:pt-20" label="Finding your party…" />
      )}
    </div>
  );
}
