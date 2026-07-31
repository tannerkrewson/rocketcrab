import React, { useContext, useEffect } from "react";
import {
    Modal as HeroModal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    Button,
    useDisclosure,
} from "@heroui/react";
import { ModalContext } from "../../utils/ModalContext";
import QRCode from "react-qr-code";

const ModalComponent = ({ state }) => {
    const { isOpen, onOpen, onOpenChange } = useDisclosure();
    const setModalState = useContext(ModalContext);

    useEffect(() => {
        if (state.title) onOpen();
    }, [onOpen, state.title]);

    const close = (isConfirmed: boolean) => {
        setModalState?.({});
        state.onClose?.({ isConfirmed });
    };

    return (
        <HeroModal
            isOpen={isOpen}
            onOpenChange={onOpenChange}
            isDismissable={false}
            hideCloseButton
        >
            <ModalContent>
                <ModalHeader className="flex flex-col gap-1">
                    {state.title}
                </ModalHeader>
                <ModalBody>
                    {state.qr ? (
                        <div className="flex justify-center">
                            <QRCode value={state.qr} />
                        </div>
                    ) : (
                        state.text
                    )}
                </ModalBody>
                <ModalFooter>
                    {state.showCancelButton && (
                        <Button color="danger" onPress={() => close(false)}>
                            {state.cancelButtonText || "Cancel"}
                        </Button>
                    )}
                    <Button color="primary" onPress={() => close(true)}>
                        {state.confirmButtonText || "OK"}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </HeroModal>
    );
};

export default ModalComponent;
