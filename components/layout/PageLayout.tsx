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
    <div className="max-w-md mx-auto px-4 pt-32">
        <MainTitle
            mode={mode}
            path={path}
            disablePhonetic={disablePhonetic}
            deemphasize={deemphasize}
        />

        {loading ? <Spinner /> : children}

        <Footer />

        {reconnecting && <Connecting />}
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
