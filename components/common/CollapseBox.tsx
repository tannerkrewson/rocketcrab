import { Chip } from "@heroui/react";
import React, { useState } from "react";
import PrimaryButton from "./PrimaryButton";

export const CollapseBox = ({
    title,
    children,
    startHidden = false,
    disableHideShow = false,
    badgeCount = 0,
    badgeType,
    onlyShowBadgeWhenCollapsed = true,
    onCollapse,
}: {
    title: string;
    children: React.ReactNode;
    startHidden: boolean;
    disableHideShow: boolean;
    badgeCount: number;
    badgeType?: string;
    onlyShowBadgeWhenCollapsed?: boolean;
    onCollapse?: (currentCollapse: boolean) => void;
}): JSX.Element => {
    const [collapse, setCollapse] = useState(startHidden);
    return (
        <>
            <div className="flex justify-between items-center">
                <h4 className="flex items-center" style={{ margin: 0 }}>
                    <span style={{ marginRight: ".25em" }}>{title}</span>
                    {badgeCount > 0 &&
                        (collapse || !onlyShowBadgeWhenCollapsed) && (
                            <Chip color={badgeType as any}>{badgeCount}</Chip>
                        )}
                </h4>
                {!disableHideShow && (
                    <PrimaryButton
                        size="sm"
                        onClick={() => {
                            const toggledCollapse = !collapse;
                            setCollapse(toggledCollapse);
                            if (onCollapse) onCollapse(toggledCollapse);
                        }}
                    >
                        {collapse ? "▼ Show" : "▲ Hide"}
                    </PrimaryButton>
                )}
            </div>
            {!collapse && children}
        </>
    );
};
