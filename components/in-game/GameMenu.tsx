import PrimaryButton from "../common/PrimaryButton";
import { MenuButton } from "../../types/types";
import React from "react";
import { Badge } from "@nextui-org/react";
import { ThemeToggle } from "../common/ThemeToggle";

const GameMenu = ({ isHost, menuButtons }: GameMenuProps): JSX.Element => {
    return (
        <div className="game-menu">
            {menuButtons
                .filter(({ hide }) => !hide)
                .map(({ label, hostOnly, onClick, badgeCount }) => (
                    <PrimaryButton
                        size="small"
                        type={hostOnly ? "error" : "secondary"}
                        disabled={!isHost && hostOnly}
                        onClick={onClick}
                        key={label}
                        style={{ marginBottom: ".7em" }}
                    >
                        {label}
                        {badgeCount > 0 && (
                            <>
                                &nbsp;
                                <Badge color="danger">{badgeCount}</Badge>
                            </>
                        )}
                    </PrimaryButton>
                ))}
            <div className="theme-toggle-container">
                <ThemeToggle />
            </div>

            <style jsx>{`
                .game-menu {
                    position: fixed;
                    width: fit-content;
                    right: 0;
                    top: 3em;
                    padding: 1em;
                    padding-bottom: 0.6em;
                    display: flex;
                    flex-direction: column;
                }
                .theme-toggle-container {
                    margin: 0.5em 0;
                    display: flex;
                    justify-content: center;
                }
            `}</style>
        </div>
    );
};

type GameMenuProps = {
    isHost: boolean;
    menuButtons: Array<MenuButton>;
};

export default GameMenu;
