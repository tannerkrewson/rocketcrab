import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { normalizePartyCode } from "@rocketcrab/party";
import { JoinFlow } from "../components/party/JoinFlow";

export const Route = createFileRoute("/join/$code")({
  component: JoinByCodePage,
});

/** Short join URLs carry exactly four letters (any case; normalized below). */
const SHORT_CODE_PATTERN = /^[A-Za-z]{4}$/u;

/**
 * The /join/:code short-join route (9fv.8): the four-letter code in the
 * PATH (never a secret — codes are public rendezvous namespaces, ADR-0004;
 * the session secret stays fragment-only, ADR-0011). Renders the same join
 * flow as /join with the code prefilled, so the player lands in the join
 * flow with the code entered. A fragment invite on top of the path
 * (/join/cvvu#secret=…) still takes the direct-join path: JoinFlow imports
 * the fragment FIRST and merges this path code only when the fragment
 * carries no code. Anything that is not exactly four letters falls through
 * to the 404 page.
 */
function JoinByCodePage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const validCode = SHORT_CODE_PATTERN.test(code);
  const normalizedCode = normalizePartyCode(code);

  useEffect(() => {
    if (!validCode || code === normalizedCode) {
      return;
    }
    void navigate({
      to: "/join/$code",
      params: { code: normalizedCode },
      hash: true,
      replace: true,
    });
  }, [code, navigate, normalizedCode, validCode]);

  if (!validCode) {
    throw notFound();
  }
  return <JoinFlow initialCode={normalizedCode} />;
}
