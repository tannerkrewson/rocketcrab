import PrimaryButton from "../common/PrimaryButton";
import { MenuButton } from "../../types/types";
import React from "react";
import { Badge } from "@geist-ui/react";

const GameMenu = ({ isHost, menuButtons }: GameMenuProps): JSX.Element => (
    <div className="game-menu">
        {menuButtons.map(({ label, hostOnly, onClick, badgeCount }) => (
            <PrimaryButton
                size="small"
                type={hostOnly ? "error" : "secondary"}
                disabled={!isHost && hostOnly}
                onClick={onClick}
                key={label}
                style={{ marginBottom: ".5em" }}
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
