import { ClientGame, GameCategory } from "../../types/types";
import { Description, Tabs } from "@geist-ui/react";

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
    <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: "1.75em", fontWeight: "bold" }}>
            {game.name}
        </div>
        <Tabs initialValue="1">
            <Tabs.Item label="Info" value="1">
                <GameInfo game={game} />
                <GamePictures pictures={game.pictures} />
                <GameBadges game={game} allCategories={allCategories} />
                <GameDescription description={game.description} />
                {showOnlyHostMessage && (
                    <Description
                        style={{ margin: "0 auto", width: "fit-content" }}
                        title="Only the host can select a game."
                        className="remove-text-transform"
                    />
                )}
            </Tabs.Item>
            {(game.guide || game.guideUrl) && (
                <Tabs.Item label="Guide" value="2">
                    <GameGuide guide={game.guide} guideUrl={game.guideUrl} />
                </Tabs.Item>
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
