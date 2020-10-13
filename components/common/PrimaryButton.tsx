import { Button } from "@geist-ui/react";
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

const ButtonWrapper = (props: PrimaryButtonProps) => (
    <Button
        type="secondary"
        ghost
        shadow
        auto={!props.manualWidth}
        style={{
            width: props.manualWidth ? "100%" : "auto",
        }}
        {...(props as any)}
    />
);

type PrimaryButtonProps = {
    size?: string;
    href?: string;
    onClick?: (e: any) => void;
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
