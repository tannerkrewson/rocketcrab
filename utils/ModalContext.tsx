import React, { createContext, useState } from "react";

import Modal from "../components/common/Modal";

export const ModalContext = createContext<((state: unknown) => void) | null>(
    null,
);

export function ModalProvider({
    children,
}: {
    children: React.ReactNode;
}): React.ReactElement {
    const [modalState, setModalState] = useState<unknown>({});

    return (
        <ModalContext.Provider value={setModalState}>
            {children}
            <Modal state={modalState} />
        </ModalContext.Provider>
    );
}
