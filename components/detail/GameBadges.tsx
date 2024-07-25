import { Chip } from "@nextui-org/react";
import { RocketcrabMode } from "../../types/enums";
import { ClientGame, GameCategory } from "../../types/types";
import SkinnyCard from "../common/SkinnyCard";

const GameBadges = ({ game, allCategories }: GameBadgesProps): JSX.Element => (
    <SkinnyCard>
        <div className="flex gap-2 flex-wrap">
            {game.category.map((categoryId) => {
                const category = allCategories.find(
                    ({ id }) => id === categoryId,
                );
                return (
                    <Chip
                        key={categoryId}
                        style={{
                            color: category.color,
                            backgroundColor: category.backgroundColor,
                        }}
                    >
                        {category.name}
                    </Chip>
                );
            })}
            <Chip>{game.players} players</Chip>
            <Chip>
                {game.showOn.includes(RocketcrabMode.KIDS)
                    ? "Family friendly"
                    : "Adults only"}
            </Chip>
        </div>
    </SkinnyCard>
);

type GameBadgesProps = {
    game: ClientGame;
    allCategories: Array<GameCategory>;
};

export default GameBadges;
