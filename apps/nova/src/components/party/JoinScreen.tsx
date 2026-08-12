import { Link } from "@tanstack/react-router";
import { KeyRound, Loader2, UserRound } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { Button, buttonStyles } from "../ui/Button";

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
 * The four-letter join screen, conformed to classic rocketcrab's layout
 * (7.21): one centered code input with large mono text, an inline "does not
 * exist" error under it, and Back + Join buttons below. Codes are normalized
 * to uppercase on entry; the party layer validates the alphabet (no I/O/L).
 * The player's name is asked here, before they enter the lobby (7.5),
 * prefilled from the last saved name.
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
  const normalized = code.trim().toUpperCase();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (normalized.length !== 4) {
      return;
    }
    onSubmit(normalized, name.trim());
  };

  // Classic feel for the common failure: a code nobody is advertising.
  const notFound = error !== null && /No party is advertising/.test(error);
  const inlineError = notFound
    ? `${normalized.length > 0 ? normalized : "That code"} does not exist 😞`
    : error;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Letters only (classic behavior); let control keys and Enter through.
    if (event.key.length === 1 && !/[a-zA-Z]/.test(event.key)) {
      event.preventDefault();
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2 pt-4 text-center">
        <KeyRound className="h-10 w-10 text-primary" aria-hidden="true" />
        <h1 className="text-3xl font-black">Join a party</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
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
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <label htmlFor="party-code" className="text-sm font-bold">
            Join Party
          </label>
          <input
            id="party-code"
            type="text"
            value={code}
            onChange={(event) => onCodeChange(event.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="abcd"
            maxLength={4}
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Four-letter party code"
            className="input input-bordered w-40 text-center font-mono text-4xl font-black tracking-[0.4em] placeholder:tracking-[0.4em]"
          />
          {inlineError !== null ? (
            <p role="alert" className="mt-1 text-center text-sm font-medium text-error">
              {inlineError}
            </p>
          ) : null}
          {notFound ? (
            <p className="text-center text-xs text-base-content/60">
              Double-check the code with your friend and that they are waiting in their lobby.
            </p>
          ) : null}
        </div>

        <div className="flex justify-center gap-3">
          <Link to="/" className={buttonStyles("outline", "lg", "flex-1")}>
            Back
          </Link>
          <Button
            variant="primary"
            size="lg"
            type="submit"
            disabled={joining || normalized.length !== 4}
            className="flex-1"
          >
            {joining ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                Joining…
              </>
            ) : (
              "Join"
            )}
          </Button>
        </div>

        <p className="text-center text-xs text-base-content/60">
          Codes are four letters (no I, O, or L) — for example “RCRB”.
        </p>
      </form>
    </div>
  );
}
