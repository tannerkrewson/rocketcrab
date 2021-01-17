/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { useEffect, useState } from "react";

export const useIsAlreadyPWA = (): boolean => {
    const [isAlreadyPWA, setIsAlreadyPWA] = useState(true);
    useEffect(() => {
        // https://stackoverflow.com/a/52695341
        setIsAlreadyPWA(
            window.matchMedia("(display-mode: standalone)").matches ||
                window.navigator.standalone ||
                document.referrer.includes("android-app://")
        );
    }, []);

    return isAlreadyPWA;
};
