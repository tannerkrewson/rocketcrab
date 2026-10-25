import { Alert } from "@heroui/react";
import { Button } from "./Button";
import { cn } from "../../lib/cn";

export interface ErrorPanelProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/** HeroUI danger alert for failed operations and route errors. */
export function ErrorPanel({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: ErrorPanelProps) {
  return (
    <Alert status="danger" role="alert" className={cn("flex flex-col gap-2", className)}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {message ? <Alert.Description>{message}</Alert.Description> : null}
        {onRetry ? (
          <div className="mt-2">
            <Button variant="default" soft onPress={onRetry}>
              Try again
            </Button>
          </div>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}
