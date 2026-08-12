import { Link } from "@tanstack/react-router";
import { KeyRound, Loader2, UserRound } from "lucide-react";
import type { FormEvent } from "react";
import { Button, buttonStyles } from "../ui/Button";
import { ErrorPanel } from "../ui/ErrorPanel";

export interface JoinScreenProps {
  /** Error from a failed join attempt (rejection, not found, timeout). */
  error: string | null;
  /** True while a join is in flight (the party route renders the lobby). */
  joining: boolean;
  /** Controlled code input (state lives in the route so it survives the
   *  joining → error transition and "Try again" keeps the typed code). */
  code: string;
  onCodeChange: (code: string) => void;
  /** Controlled name input (prefilled from the saved player name, 7.5). */
  name: string;
  onNameChange: (name: string) => void;
  /** Submit a join attempt with the chosen player name (7.5). */
  onSubmit: (code: string, name: string) => void;
}

/**
 * The four-letter join screen (P2/P4): type a friend's code, tap Join, and
 * wait for the greeter to admit you. Codes are normalized to uppercase on
 * entry; the party layer validates the alphabet (no I/O/L). The player's
 * name is asked here, before they enter the lobby (7.5), prefilled from the
 * last saved name.
 */
export function JoinScreen({
  error,
  joining,
  code,
  onCodeChange,
  name,
  onNameChange,
  onSubmit,
}: JoinScreenProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized.length === 0) {
      return;
    }
    onSubmit(normalized, name.trim());
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <KeyRound className="h-10 w-10 text-primary" aria-hidden="true" />
        <h1 className="text-3xl font-black">Join a party</h1>
        <p className="text-base-content/70">
          Ask a friend for their four-letter code. They&apos;ll approve your request when you join.
        </p>
      </div>

      {error !== null ? (
        <ErrorPanel
          title="Couldn't join that party"
          message={error}
          onRetry={() => onSubmit(code.trim().toUpperCase(), name.trim())}
        />
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="player-name" className="text-sm font-bold">
          Your name
        </label>
        <div className="relative">
          <UserRound
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-base-content/40"
            aria-hidden="true"
          />
          <input
            id="player-name"
            type="text"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Your name"
            maxLength={24}
            autoComplete="nickname"
            aria-label="Your player name"
            className="input input-bordered w-full pl-10"
          />
        </div>
        <label htmlFor="party-code" className="text-sm font-bold">
          Party code
        </label>
        <input
          id="party-code"
          type="text"
          value={code}
          onChange={(event) => onCodeChange(event.target.value.toUpperCase())}
          placeholder="ABCD"
          maxLength={4}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Four-letter party code"
          className="input input-bordered text-center font-mono text-4xl font-black tracking-[0.5em] placeholder:tracking-[0.5em]"
        />
        <Button variant="primary" size="lg" type="submit" disabled={joining || code.length === 0}>
          {joining ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Joining…
            </>
          ) : (
            "Join party"
          )}
        </Button>
        <p className="text-center text-xs text-base-content/60">
          Codes are four letters (no I, O, or L) — for example “RCRB”.
        </p>
      </form>

      <div className="flex justify-center">
        <Link to="/" className={buttonStyles("ghost")}>
          Back to home
        </Link>
      </div>
    </div>
  );
}
