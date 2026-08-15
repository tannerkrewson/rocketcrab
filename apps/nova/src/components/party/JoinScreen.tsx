import { Link } from "@tanstack/react-router";
import { KeyRound, Loader2, UserRound } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { phoneticSpelling } from "../../lib/party/phonetic";
import { Button, buttonStyles } from "../ui/Button";

/** What this screen is doing: joining a party, or editing the player name. */
export type JoinMode = "join" | "edit";

export interface JoinScreenProps {
  /** "join" = the /join code-entry flow; "edit" = the name-editing page
   *  (the same name step, opened from the lobby's pencil / no-name prompt). */
  mode?: JoinMode;
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
  /** Submit: join mode = join with the code and current name; edit mode =
   *  save the chosen player name (7.5). */
  onSubmit: (code: string, name: string) => void;
  /** Edit mode: navigate back (to the party/lobby or the join form). */
  onBack: () => void;
}

/**
 * Join flow (7.47, reworked 2t1.9): enter the four-letter code in a tall,
 * wide mono input — the join happens directly from the code step, and the
 * player's name is ONLY asked once they are in the lobby (the edit mode
 * below). Codes are normalized to lowercase on entry (the party layer
 * validates its own alphabet); the phonetic spelling confirms the
 * code inline once it is complete. The player's name is prefilled from the
 * last saved name (7.5).
 *
 * Edit mode reuses the same name-entry presentation (UserRound icon,
 * pl-10 input, visible "Your name" label, maxLength 24) as the old join
 * name step — the lobby's pencil / no-name prompt land here via
 * `/join?edit=name`.
 */
export function JoinScreen({
  mode = "join",
  error,
  joining,
  code,
  onCodeChange,
  name,
  onNameChange,
  onSubmit,
  onBack,
}: JoinScreenProps) {
  const editing = mode === "edit";
  const normalized = code.trim().toLowerCase();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing && normalized.length !== 4) {
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
        {editing ? (
          <UserRound className="h-10 w-10 text-primary" aria-hidden="true" />
        ) : (
          <KeyRound className="h-10 w-10 text-primary" aria-hidden="true" />
        )}
        <h1 className="text-3xl font-black">{editing ? "Your name" : "Join a party"}</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5" noValidate>
        {editing ? (
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
                autoFocus
                className="input input-bordered w-full pl-10"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <label htmlFor="party-code" className="text-sm font-bold">
              Party code
            </label>
            <input
              id="party-code"
              type="text"
              value={code}
              onChange={(event) => onCodeChange(event.target.value.toLowerCase())}
              onKeyDown={handleKeyDown}
              placeholder="abcd"
              maxLength={4}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Four-letter party code"
              className="input input-bordered input-xl w-48 text-center font-mono text-4xl font-black"
            />
            {normalized.length === 4 ? (
              <p className="text-center text-sm text-base-content/60">
                <span className="font-mono font-bold text-primary">{normalized}</span> —{" "}
                <span className="text-base-content/50">({phoneticSpelling(normalized)})</span>
              </p>
            ) : null}
          </div>
        )}

        {inlineError !== null ? (
          <p role="alert" className="text-center text-sm font-medium text-error">
            {inlineError}
          </p>
        ) : null}
        {notFound ? (
          <p className="text-center text-xs text-base-content/60">
            Double-check the code with your friend and that they are waiting in their lobby.
          </p>
        ) : null}

        <div className="flex justify-center gap-3">
          {editing ? (
            <Button
              variant="default"
              soft
              size="lg"
              type="button"
              className="flex-1"
              onClick={onBack}
            >
              Back
            </Button>
          ) : (
            <Link to="/" className={buttonStyles("default", "lg", "flex-1", true)}>
              Back
            </Link>
          )}
          {editing ? (
            <Button
              variant="primary"
              size="lg"
              type="submit"
              disabled={name.trim().length === 0}
              className="flex-1"
            >
              Save
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              type="submit"
              disabled={normalized.length !== 4 || joining}
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
          )}
        </div>
      </form>
    </div>
  );
}
