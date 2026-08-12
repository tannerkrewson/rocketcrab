import { Link } from "@tanstack/react-router";
import { KeyRound, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, buttonStyles } from "../ui/Button";
import { ErrorPanel } from "../ui/ErrorPanel";

export interface JoinScreenProps {
  /** Error from a failed join attempt (rejection, not found, timeout). */
  error: string | null;
  /** True while a join is in flight (the party route renders the lobby). */
  joining: boolean;
  onSubmit: (code: string) => void;
}

/**
 * The four-letter join screen (P2/P4): type a friend's code, tap Join, and
 * wait for the greeter to admit you. Codes are normalized to uppercase on
 * entry; the party layer validates the alphabet (no I/O/L).
 */
export function JoinScreen({ error, joining, onSubmit }: JoinScreenProps) {
  const [code, setCode] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized.length === 0) {
      return;
    }
    onSubmit(normalized);
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
          onRetry={() => onSubmit(code.trim().toUpperCase())}
        />
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="party-code" className="text-sm font-bold">
          Party code
        </label>
        <input
          id="party-code"
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
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
