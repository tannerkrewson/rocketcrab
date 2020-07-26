import PrimaryButton from "../atoms/PrimaryButton";
import { Spacer } from "@zeit-ui/react";

const GameMenu = ({
    onExitGame,
    onReloadMine,
    onStartGame,
    onViewGames,
}: GameMenuProps): JSX.Element => (
    <div className="game-menu">
        <PrimaryButton size="small" onClick={onReloadMine}>
            Reload my game
        </PrimaryButton>
        <Spacer y={0.5} />
        <PrimaryButton size="small" onClick={onViewGames}>
            View games
        </PrimaryButton>
        <Spacer y={0.5} />
        <PrimaryButton size="small" type="error" onClick={onStartGame}>
            Reload all
        </PrimaryButton>
        <Spacer y={0.5} />
        <PrimaryButton type="error" size="small" onClick={onExitGame}>
            Exit to lobby
        </PrimaryButton>
        <style jsx>{`
            .game-menu {
                position: fixed;
                width: fit-content;
                border: 1px solid LightGrey;
                border-top: 1px solid white;
                right: 0;
                top: 3em;
                padding: 1em;
                background: white;
                display: flex;
                flex-direction: column;
            }
        `}</style>
    </div>
);

type GameMenuProps = {
    onExitGame: () => void;
    onReloadMine: () => void;
    onStartGame: () => void;
    onViewGames: () => void;
};

export default GameMenu;
