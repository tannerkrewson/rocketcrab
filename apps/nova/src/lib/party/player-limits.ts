/** A game's optional player range, from its declaration or its list entry. */
export interface PlayerLimits {
  readonly minPlayers?: number;
  readonly maxPlayers?: number;
}

/** Keep only usable limits: whole numbers from 1, and a finite maximum. */
export function playerLimitsOf(source: PlayerLimits | undefined): PlayerLimits {
  const valid = (value: number | undefined): value is number =>
    value !== undefined && Number.isInteger(value) && value >= 1;
  return {
    ...(valid(source?.minPlayers) ? { minPlayers: source.minPlayers } : {}),
    ...(valid(source?.maxPlayers) ? { maxPlayers: source.maxPlayers } : {}),
  };
}

function players(count: number): string {
  return count === 1 ? "1 player" : `${count} players`;
}

/**
 * Lobby text when the party is outside the game's range, or null. Limits
 * are advisory: the host can still start the game.
 */
export function playerLimitNotice(count: number, limits: PlayerLimits): string | null {
  const { minPlayers, maxPlayers } = playerLimitsOf(limits);
  if (minPlayers !== undefined && count < minPlayers) {
    const missing = minPlayers - count;
    return `This game needs at least ${players(minPlayers)}. Invite ${missing} more.`;
  }
  if (maxPlayers !== undefined && count > maxPlayers) {
    return `This game supports at most ${players(maxPlayers)}. The party has ${count}.`;
  }
  return null;
}

/** "2–8", "2+", "Up to 8", or undefined when the game sets no limits. */
export function formatPlayerRange(limits: PlayerLimits): string | undefined {
  const { minPlayers, maxPlayers } = playerLimitsOf(limits);
  if (minPlayers !== undefined && maxPlayers !== undefined) {
    return minPlayers === maxPlayers ? `${minPlayers}` : `${minPlayers}–${maxPlayers}`;
  }
  if (minPlayers !== undefined) return `${minPlayers}+`;
  if (maxPlayers !== undefined) return `Up to ${maxPlayers}`;
  return undefined;
}
