import { NATO_PHONETIC_ALPHABET } from "phonetic-alphabet-converter";
import { Textfit } from "@aw-web-design/react-textfit";
import { RocketcrabMode } from "../../types/enums";
import { MODE_MAP } from "../../utils/utils";
import classNames from "classnames";
import ClickToCopy from "../common/ClickToCopy";

const MainTitle = ({
    path = "",
    disablePhonetic,
    deemphasize,
    mode,
}: MainTitleProps): JSX.Element => {
    const host = MODE_MAP[mode];
    const title = host + (path ? "/" + path : "");

    return (
        <div
            className={classNames({
                "text-center transition-all duration-100 ease-out": true,
                "-mt-1 -mb-8 scale-75 saturate-50 opacity-50 blur-sm":
                    deemphasize,
            })}
        >
            <div className="flex justify-center items-center">
                <img
                    src="/rocket.svg"
                    className="h-10 mr-3"
                    style={{ filter: "drop-shadow(0 0 6px cyan)" }}
                    alt="rocketcrab logo"
                />
                <img
                    src="/crab.svg"
                    className="h-10"
                    style={{ filter: "drop-shadow(0 0 6px #ff0000d9)" }}
                    alt="rocketcrab logo"
                />
            </div>
            <Textfit mode="single">
                <ClickToCopy>
                    <div
                        className="font-bold my-2 cursor-pointer select-none font-mono text-[1.7em] transition-transform duration-200 ease-out active:scale-90 sm:text-[2.4em]"
                        style={{ fontFamily: '"Inconsolata", monospace' }}
                    >
                        {title}
                    </div>
                </ClickToCopy>
            </Textfit>

            {path && !disablePhonetic && (
                <div className="-mt-2 mb-6 text-sm italic">
                    (
                    {path
                        .toLowerCase()
                        .split("")
                        .map((letter) => NATO_PHONETIC_ALPHABET[letter])
                        .filter(Boolean)
                        .join(" ")}
                    )
                </div>
            )}
        </div>
    );
};

type MainTitleProps = {
    path?: string;
    disablePhonetic?: boolean;
    deemphasize?: boolean;
    mode: RocketcrabMode;
};

export default MainTitle;
