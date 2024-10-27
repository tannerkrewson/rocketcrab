import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { cloneElement, useCallback, useState } from "react";

const ClickToCopy = ({ children }) => {
    const [copiedTooltip, setCopiedTooltip] = useState(false);

    const linkCopyClick = useCallback(() => {
        setCopiedTooltip(true);
        navigator.clipboard.writeText(window.location.href);

        setTimeout(() => setCopiedTooltip(false), 1000);
    }, []);

    return (
        <Popover
            isOpen={copiedTooltip}
            onOpenChange={(open) => setCopiedTooltip(open)}
        >
            <PopoverTrigger>
                {cloneElement(children, { onClick: linkCopyClick })}
            </PopoverTrigger>
            <PopoverContent>
                <div className="text-medium">Copied!</div>
            </PopoverContent>
        </Popover>
    );
};

export default ClickToCopy;
