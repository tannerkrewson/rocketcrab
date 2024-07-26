import PrimaryButton from "../common/PrimaryButton";
import { MenuButton } from "../../types/types";
import React from "react";
import { Badge } from "@nextui-org/react";
import { ThemeToggle } from "../common/ThemeToggle";

const GameMenu = ({ isHost, menuButtons }: GameMenuProps): JSX.Element => {
    return (
        <div className="fixed right-0 top-12 p-4 flex flex-col gap-2 bg-background shadow-md">
            {menuButtons
                .filter(({ hide }) => !hide)
                .map(({ label, hostOnly, onClick, badgeCount }) => (
                    <PrimaryButton
                        size="sm"
                        color={hostOnly ? "danger" : "default"}
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
            <div className="flex justify-center">
                <ThemeToggle />
            </div>
        </div>
    );
};

type GameMenuProps = {
    isHost: boolean;
    menuButtons: Array<MenuButton>;
};

export default GameMenu;
