import { Button } from "@nextui-org/react";
import Link from "next/link";

const PrimaryButton = (props: PrimaryButtonProps): JSX.Element => {
    if (props.href) {
        return (
            // TODO: remove locale when sending to prod
            <Link href={props.href} locale={false}>
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

const ButtonWrapper = (props: PrimaryButtonProps) => (
    <Button
        size={props.size}
        onClick={props.onClick}
        isDisabled={props.disabled}
        isLoading={props.loading}
        variant={props.variant || "faded"}
        color={props.color}
        fullWidth={props.manualWidth}
    >
        {props.children}
    </Button>
);

type PrimaryButtonProps = {
    size?: "sm" | "md" | "lg";
    href?: string;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    children?: React.ReactNode;
    loading?: boolean;
    variant?:
        | "faded"
        | "solid"
        | "bordered"
        | "light"
        | "flat"
        | "shadow"
        | "ghost";
    color?:
        | "warning"
        | "default"
        | "primary"
        | "secondary"
        | "success"
        | "danger";
    url?: string;
    manualWidth?: boolean;
    style?: Record<string, string>;
};

export default PrimaryButton;
