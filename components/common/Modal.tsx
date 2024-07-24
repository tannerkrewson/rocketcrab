import React, { useContext, useEffect } from "react";
import {
    Modal as NextModal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    Button,
    useDisclosure,
} from "@nextui-org/react";
import { ModalContext } from "../../pages/_app";

const Modal = ({ state }) => {
    const { isOpen, onOpen, onOpenChange } = useDisclosure();

    const setModalState = useContext(ModalContext);

    useEffect(() => {
        if (state.title) {
            onOpen();
        }
    }, [onOpen, state]);

    return (
        <NextModal
            isOpen={isOpen}
            onOpenChange={onOpenChange}
            isDismissable={false}
            hideCloseButton={true}
        >
            <ModalContent>
                {(onClose) => (
                    <>
                        <ModalHeader className="flex flex-col gap-1">
                            {state.title}
                        </ModalHeader>
                        <ModalBody>{state.text}</ModalBody>
                        <ModalFooter>
                            {state.showCancelButton && (
                                <Button
                                    color="danger"
                                    variant="light"
                                    onPress={() => {
                                        onClose();
                                        setModalState({});

                                        if (state.onClose) {
                                            state.onClose({
                                                isConfirmed: false,
                                            });
                                        }
                                    }}
                                >
                                    {state.cancelButtonText
                                        ? state.cancelButtonText
                                        : "Cancel"}
                                </Button>
                            )}
                            <Button
                                color="primary"
                                onPress={() => {
                                    onClose();
                                    setModalState({});

                                    if (state.onClose) {
                                        state.onClose({ isConfirmed: true });
                                    }
                                }}
                            >
                                {state.confirmButtonText
                                    ? state.confirmButtonText
                                    : "OK"}
                            </Button>
                        </ModalFooter>
                    </>
                )}
            </ModalContent>
        </NextModal>
    );
};

export default Modal;
