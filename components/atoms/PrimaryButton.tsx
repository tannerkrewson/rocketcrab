import { Button } from "@zeit-ui/react";
import Link from "next/link";

const PrimaryButton = (props: PrimaryButtonProps): JSX.Element =>
    props.href ? (
        <Link href={props.href} as={props.as}>
            <div>
                <ButtonWrapper {...props} />
            </div>
        </Link>
    ) : (
        <ButtonWrapper {...props} />
    );

const ButtonWrapper = (props: PrimaryButtonProps) => (
    <Button type="secondary" ghost shadow auto {...(props as any)} />
);

type PrimaryButtonProps = {
    size?: string;
    href?: string;
    onClick?: (e: any) => void;
    disabled?: boolean;
    as?: string;
    children?: React.ReactNode;
    loading?: boolean;
};

export default PrimaryButton;
