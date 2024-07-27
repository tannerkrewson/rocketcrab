import { Spinner } from "@nextui-org/react";
import { RocketcrabMode } from "../../types/enums";
import Connecting from "./Connecting";
import Footer from "./Footer";
import MainTitle from "./MainTitle";

const PageLayout = ({
    children,
    path,
    loading,
    disablePhonetic,
    deemphasize,
    reconnecting,
    mode,
}: PageLayoutParams): JSX.Element => (
    <div className="flex min-h-svh items-center flex-col">
        <div className="flex flex-col justify-center flex-1 max-w-md px-2 w-full">
            <MainTitle
                mode={mode}
                path={path}
                disablePhonetic={disablePhonetic}
                deemphasize={deemphasize}
            />

            {loading ? <Spinner /> : children}

            {reconnecting && <Connecting />}
        </div>
        <div className="w-full">
            <Footer />
        </div>
    </div>
);

type PageLayoutParams = {
    children: React.ReactNode;
    path?: string;
    loading?: boolean;
    disablePhonetic?: boolean;
    deemphasize?: boolean;
    reconnecting?: boolean;
    mode: RocketcrabMode;
};

export default PageLayout;
