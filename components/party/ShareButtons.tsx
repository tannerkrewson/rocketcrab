import { Button, Card, CardBody } from "@nextui-org/react";
import { useContext } from "react";
import { ModalContext } from "../../pages/_app";
import ClickToCopy from "../common/ClickToCopy";

const ShareButtons = () => {
    const fireModal = useContext(ModalContext);
    const canShare = navigator?.canShare && navigator.canShare();

    return (
        <Card>
            <CardBody className="text-center">
                <div className="mb-2">Get your friends to join!</div>
                <div className="flex flex-row gap-2 justify-center">
                    {canShare && (
                        <Button
                            onClick={() =>
                                navigator.share({
                                    title: "Rocketcrab",
                                    text: "Join my Rocketcrab party!",
                                    url: window.location.href,
                                })
                            }
                            fullWidth={false}
                        >
                            Share
                        </Button>
                    )}

                    <ClickToCopy>
                        <Button>Copy URL</Button>
                    </ClickToCopy>

                    <Button
                        onClick={() =>
                            fireModal({
                                title: `QR code for ${window.location.host}${window.location.pathname}`,
                                qr: window.location.href,
                            })
                        }
                    >
                        QR Code
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
};

export default ShareButtons;
