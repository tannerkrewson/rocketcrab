import { ClientGame, GameCategory } from "../../types/types";
import { Tabs } from "@heroui/react";

import GameInfo from "./GameInfo";
import GameDescription from "./GameDescription";
import GameBadges from "./GameBadges";
import GamePictures from "./GamePictures";
import GameGuide from "./GameGuide";

const GameDetail = ({
    game,
    allCategories,
    showOnlyHostMessage,
}: GameDetailProps): JSX.Element => (
    <div className="text-center">
        <div style={{ fontSize: "1.75em", fontWeight: "bold" }}>
            {game.name}
        </div>
        <Tabs>
            <Tabs.List>
                <Tabs.Tab id="info">Info</Tabs.Tab>
                {(game.guide || game.guideUrl) && (
                    <Tabs.Tab id="guide">Guide</Tabs.Tab>
                )}
            </Tabs.List>
            <Tabs.Panel id="info">
                <div className="space-y-3">
                    <GameInfo game={game} />
                    <GamePictures pictures={game.pictures} />
                    <GameBadges game={game} allCategories={allCategories} />
                    <GameDescription description={game.description} />
                    {showOnlyHostMessage && (
                        <div>Only the host can select a game.</div>
                    )}
                </div>
            </Tabs.Panel>
            {(game.guide || game.guideUrl) && (
                <Tabs.Panel id="guide">
                    <GameGuide guide={game.guide} guideUrl={game.guideUrl} />
                </Tabs.Panel>
            )}
        </Tabs>
    </div>
);

type GameDetailProps = {
    game: ClientGame;
    allCategories: Array<GameCategory>;
    showOnlyHostMessage?: boolean;
};

export default GameDetail;
