import { Checkbox, CheckboxGroup, Label, Switch } from "@heroui/react";
import { useState } from "react";
import { useSavedGames } from "../../lib/games/queries";
import { usePartyEngine } from "../../lib/party/use-party";
import { toast } from "../../lib/toast";
import { Button } from "../ui/Button";

/**
 * Asks a guest with games of their own which ones the host may pick. Shown
 * inline in the lobby until they answer; the host never sees it.
 */
export function ShareGamesCard() {
  const { engine, state } = usePartyEngine();
  const gamesQuery = useSavedGames();
  const [selected, setSelected] = useState<string[]>([]);
  const [saveable, setSaveable] = useState(true);
  const [sharing, setSharing] = useState(false);
  const games = gamesQuery.data ?? [];
  if (state.amHost || state.myOffer !== null || games.length === 0) return null;

  const share = async () => {
    setSharing(true);
    try {
      const picked = games.filter((game) => selected.includes(game.id));
      await engine.shareGames(
        picked.map((game) => ({
          gameId: game.id,
          title: game.title,
          source: game.html,
          ...(game.apiVersion !== undefined ? { apiVersion: game.apiVersion } : {}),
        })),
        saveable,
      );
      toast.success(
        picked.length === 1
          ? "Shared 1 game with the host."
          : `Shared ${picked.length} games with the host.`,
      );
    } catch (error) {
      toast.danger(`Couldn't share your games: ${error instanceof Error ? error.message : error}`);
      setSharing(false);
    }
  };

  return (
    <section aria-label="Share your games" className="glass flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex flex-col gap-1 text-center">
        <h2 className="text-lg font-black">Share your games?</h2>
        <p className="text-sm text-foreground/70">The host can pick any game you share.</p>
      </div>
      <CheckboxGroup
        aria-label="Your games"
        value={selected}
        onChange={setSelected}
        className="flex flex-col gap-1"
      >
        {games.map((game) => (
          <Checkbox
            key={game.id}
            value={game.id}
            className="mt-0 flex-row items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-secondary"
          >
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Checkbox.Content>
              <Label className="truncate font-semibold">{game.title}</Label>
            </Checkbox.Content>
          </Checkbox>
        ))}
      </CheckboxGroup>
      <Switch
        isSelected={saveable}
        onChange={setSaveable}
        className="flex-row items-center gap-3 px-3"
      >
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <Switch.Content>
          <Label className="text-sm">Let players save copies</Label>
        </Switch.Content>
      </Switch>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="default" soft onClick={() => engine.declineSharing()}>
          Not now
        </Button>
        <Button
          variant="primary"
          disabled={selected.length === 0 || sharing}
          onClick={() => void share()}
        >
          {selected.length > 1 ? `Share ${selected.length} games` : "Share"}
        </Button>
      </div>
    </section>
  );
}
