import { Button } from "@heroui/react";
import { Link } from "@tanstack/react-router";

const PrimaryButton = (props: PrimaryButtonProps): JSX.Element => {
    if (props.href) {
        return (
            <Link to={props.href}>
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
        size={props.size as any}
        onClick={props.onClick}
        isDisabled={props.disabled}
        {...(props.loading ? { isDisabled: true } : {})}
        variant={(props.variant as any) || "secondary"}
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
    variant?: string;
    color?: string;
    url?: string;
    manualWidth?: boolean;
    style?: Record<string, string>;
};

export default PrimaryButton;
