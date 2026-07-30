import { Popover } from "@heroui/react";
import { cloneElement, useCallback } from "react";

const ClickToCopy = ({ children }) => {
    const linkCopyClick = useCallback(() => {
        navigator.clipboard.writeText(window.location.href);
    }, []);

    return (
        <Popover>
            <Popover.Trigger>
                {cloneElement(children, { onClick: linkCopyClick })}
            </Popover.Trigger>
            <Popover.Dialog>
                <Popover.Content>
                    <div className="text-medium">Copied!</div>
                </Popover.Content>
            </Popover.Dialog>
        </Popover>
    );
};

export default ClickToCopy;
