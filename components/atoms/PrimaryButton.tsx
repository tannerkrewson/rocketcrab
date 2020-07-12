import { Button } from "@zeit-ui/react";
import Link from "next/link";

const PrimaryButton = (props) =>
    props.href ? (
        <Link href={props.href} as={props.as}>
            <div>
                <ButtonWrapper {...props} />
            </div>
        </Link>
    ) : (
        <ButtonWrapper {...props} />
    );

const ButtonWrapper = (props) => (
    <Button type="secondary" ghost shadow auto {...props} />
);

export default PrimaryButton;
