import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@heroui/react";
import { cloneElement, useCallback, useState } from "react";

const ClickToCopy = ({ children }) => {
    const [copied, setCopied] = useState(false);
    const linkCopyClick = useCallback(() => {
        navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1000);
    }, []);

    return (
        <Popover isOpen={copied} onOpenChange={setCopied}>
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
