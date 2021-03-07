import { Badge } from "@geist-ui/react";
import { RocketcrabMode } from "../../types/enums";
import { ClientGame, GameCategory } from "../../types/types";
import SkinnyCard from "../common/SkinnyCard";

const GameBadges = ({ game, allCategories }: GameBadgesProps): JSX.Element => (
    <SkinnyCard>
        {game.category.map((categoryId) => {
            const category = allCategories.find(({ id }) => id === categoryId);
            return (
                <SpaceBadge
                    key={categoryId}
                    style={{
                        color: category.color,
                        backgroundColor: category.backgroundColor,
                    }}
                >
                    {category.name}
                </SpaceBadge>
            );
        })}
        <SpaceBadge>{game.players} players</SpaceBadge>
        <SpaceBadge>
            {game.showOn.includes(RocketcrabMode.KIDS)
                ? "Family friendly"
                : "Adults only"}
        </SpaceBadge>
    </SkinnyCard>
);

const SpaceBadge = ({ children, style = {} }) => (
    <span style={{ margin: ".1em" }}>
        <Badge style={style}>{children}</Badge>
    </span>
);

type GameBadgesProps = {
    game: ClientGame;
    allCategories: Array<GameCategory>;
};

export default GameBadges;
