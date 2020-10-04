import Dexie from "dexie";

export class RocketcrabDexie extends Dexie {
    recentGames: Dexie.Table<RecentGame, string>;

    constructor() {
        super("RocketcrabDexie");
        this.version(1).stores({
            recentGames: "gameId,date",
        });
        this.recentGames = this.table("recentGames");
    }

    addGame(gameId: string): void {
        this.recentGames.put({ gameId, date: Date.now() });
    }
}

type RecentGame = {
    gameId?: string;
    date: number;
};
