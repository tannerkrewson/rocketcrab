import { Button } from "@nextui-org/react";
import Link from "next/link";

const PrimaryButton = (props: PrimaryButtonProps): JSX.Element => {
    if (props.href) {
        return (
            <Link href={props.href} as={props.as}>
                <div>
                    <ButtonWrapper {...props} />
                </div>
            </Link>
        );
    } else if (props.url) {
        return (
            <a
                href={props.url}
                target="_blank"
                rel="noopener noreferrer"
                className="link"
                style={{
                    lineHeight: props.manualWidth ? "0" : "initial",
                }}
            >
                <ButtonWrapper {...props} />
            </a>
        );
    } else {
        return <ButtonWrapper {...props} />;
    }
};

const ButtonWrapper = ({ manualWidth, ...props }: PrimaryButtonProps) => (
    <Button
        color="default"
        style={{
            width: manualWidth ? "100%" : "auto",
        }}
        {...props}
        ghost
        shadow
        auto={!manualWidth}
    />
);

type PrimaryButtonProps = {
    size?: string;
    href?: string;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    as?: string;
    children?: React.ReactNode;
    loading?: boolean;
    type?: string;
    url?: string;
    manualWidth?: boolean;
    style?: Record<string, string>;
};

export default PrimaryButton;
