import { Spinner } from "@nextui-org/react";
import { useState } from "react";

const Connecting = (): JSX.Element => {
    const [collapseText, setCollapseText] = useState(false);
    return (
        <div
            className="loading-popup"
            onClick={() => setCollapseText(!collapseText)}
        >
            <span className="icon-container">
                <Spinner size="sm" color="danger" />
            </span>
            {!collapseText && <span>🚀🦀 Reconnecting...</span>}
            <style jsx>{`
                .loading-popup {
                    display: flex;
                    flex-direction: row;
                    position: absolute;
                    bottom: 1em;
                    left: 1em;
                    border-radius: 1em;
                    background: #fad3cf;
                    padding: 0.3em;
                    box-shadow: 2px 2px 6px rgba(0, 0, 0, 0.12);
                    cursor: pointer;
                    color: black;
                }
                .icon-container {
                    width: 2em;
                }
            `}</style>
        </div>
    );
};

export default Connecting;
