import PrimaryButton from "../common/PrimaryButton";
import { MenuButton } from "../../types/types";
import React from "react";
import { Badge, useTheme } from "@geist-ui/react";

const GameMenu = ({ isHost, menuButtons }: GameMenuProps): JSX.Element => {
    const {
        palette: { accents_1, accents_2 },
    } = useTheme();

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
                                <Badge type="error" size="mini">
                                    {badgeCount}
                                </Badge>
                            </>
                        )}
                    </PrimaryButton>
                ))}
            <style jsx>{`
                .game-menu {
                    position: fixed;
                    width: fit-content;
                    border-left: 1px solid ${accents_2};
                    border-bottom: 1px solid ${accents_2};
                    right: 0;
                    top: 3em;
                    padding: 1em;
                    padding-bottom: 0.6em;
                    background: ${accents_1};
                    display: flex;
                    flex-direction: column;
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
