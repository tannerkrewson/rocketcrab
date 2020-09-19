import PrimaryButton from "../atoms/PrimaryButton";
import { Spacer } from "@zeit-ui/react";
import { MenuButton } from "../../types/types";

const GameMenu = ({ isHost, menuButtons }: GameMenuProps): JSX.Element => (
    <div className="game-menu">
        {menuButtons.map(
            ({ label, hostOnly, onClick }) =>
                (!hostOnly || (isHost && hostOnly)) && (
                    <>
                        <PrimaryButton
                            size="small"
                            type={hostOnly ? "error" : "secondary"}
                            onClick={onClick}
                        >
                            {label}
                        </PrimaryButton>
                        <Spacer y={0.5} />
                    </>
                )
        )}
        <style jsx>{`
            .game-menu {
                position: fixed;
                width: fit-content;
                border: 1px solid #ddd;
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
    isHost: boolean;
    menuButtons: Array<MenuButton>;
};

export default GameMenu;
