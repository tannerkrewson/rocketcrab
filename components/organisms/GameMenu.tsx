import PrimaryButton from "../atoms/PrimaryButton";

const GameMenu = ({ onExitGame }: GameMenuProps): JSX.Element => (
    <div className="game-menu">
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
};

export default GameMenu;
