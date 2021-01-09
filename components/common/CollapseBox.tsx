import { Badge } from "@geist-ui/react";
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
    badgeType?: "default" | "secondary" | "success" | "warning" | "error";
    onlyShowBadgeWhenCollapsed?: boolean;
    onCollapse?: (currentCollapse: boolean) => void;
}): JSX.Element => {
    const [collapse, setCollapse] = useState(startHidden);
    return (
        <>
            <div className="flex-center-row">
                <h4 className="flex-center-row" style={{ margin: 0 }}>
                    <span style={{ marginRight: ".25em" }}>{title}</span>
                    {badgeCount > 0 &&
                        (collapse || !onlyShowBadgeWhenCollapsed) && (
                            <Badge type={badgeType}>{badgeCount}</Badge>
                        )}
                </h4>
                {!disableHideShow && (
                    <PrimaryButton
                        size="mini"
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

            <style jsx>{`
                .flex-center-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
            `}</style>
        </>
    );
};
