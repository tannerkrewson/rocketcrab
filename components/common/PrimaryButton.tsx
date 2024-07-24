import { Button } from "@geist-ui/core";
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
        placeholder={undefined}
        onPointerEnterCapture={undefined}
        onPointerLeaveCapture={undefined}
        // @ts-expect-error this error makes no sense
        type="secondary"
        {...props}
        ghost
        shadow
        auto={!manualWidth}
        style={{
            width: manualWidth ? "100%" : "auto",
        }}
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
