import { Spinner } from "@heroui/react";
import { useState } from "react";

const Connecting = (): JSX.Element => {
    const [collapseText, setCollapseText] = useState(false);
    return (
        <div
            className="flex flex-row absolute bottom-4 left-4 rounded-full bg-rose-200 p-1 shadow-md cursor-pointer text-black"
            onClick={() => setCollapseText(!collapseText)}
        >
            <span className="w-8">
                <Spinner size="sm" color="danger" />
            </span>
            {!collapseText && <span>🚀🦀 Reconnecting...</span>}
        </div>
    );
};

export default Connecting;
