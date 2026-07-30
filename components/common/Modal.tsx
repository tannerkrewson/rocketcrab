import React, { useContext, useEffect } from "react";
import { Modal, Button, useOverlayState } from "@heroui/react";
import { ModalContext } from "../../pages/_app";
import QRCode from "react-qr-code";

const ModalComponent = ({ state }) => {
    const overlayState = useOverlayState();

    const setModalState = useContext(ModalContext);

    useEffect(() => {
        if (state.title) {
            overlayState.open();
        }
    }, [overlayState, state]);

    return (
        <Modal state={overlayState}>
            <Modal.Backdrop />
            <Modal.Container>
                <Modal.Dialog>
                    <Modal.Header className="flex flex-col gap-1">
                        {state.title}
                    </Modal.Header>
                    <Modal.Body>
                        {state.qr ? (
                            <div className="flex justify-center">
                                <QRCode value={state.qr} />
                            </div>
                        ) : (
                            state.text
                        )}
                    </Modal.Body>
                    <Modal.Footer>
                        {state.showCancelButton && (
                            <Button
                                color="danger"
                                variant="light"
                                onPress={() => {
                                    overlayState.close();
                                    setModalState?.({});

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
                                overlayState.close();
                                setModalState?.({});

                                if (state.onClose) {
                                    state.onClose({ isConfirmed: true });
                                }
                            }}
                        >
                            {state.confirmButtonText
                                ? state.confirmButtonText
                                : "OK"}
                        </Button>
                    </Modal.Footer>
                </Modal.Dialog>
            </Modal.Container>
        </Modal>
    );
};

export default ModalComponent;
