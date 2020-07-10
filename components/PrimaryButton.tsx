import { Button } from "@zeit-ui/react";
import Link from "next/link";

const PrimaryButton = (props) =>
    props.href ? (
        <Link href={props.href} as={props.as}>
            <ButtonWrapper {...props} />
        </Link>
    ) : (
        <ButtonWrapper {...props} />
    );

const ButtonWrapper = (props) => (
    <Button type="secondary" size="large" ghost shadow auto {...props} />
);

export default PrimaryButton;
