import { ClientGame, GameCategory } from "../../types/types";
import { Tabs, Tab } from "@nextui-org/react";

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
            <Tab title="Info">
                <div className="space-y-3">
                    <GameInfo game={game} />
                    <GamePictures pictures={game.pictures} />
                    <GameBadges game={game} allCategories={allCategories} />
                    <GameDescription description={game.description} />
                    {showOnlyHostMessage && (
                        <div>Only the host can select a game.</div>
                    )}
                </div>
            </Tab>
            {(game.guide || game.guideUrl) && (
                <Tab title="Guide">
                    <GameGuide guide={game.guide} guideUrl={game.guideUrl} />
                </Tab>
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
