import { CircleAlert } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Says what couldn't be loaded and why, with a button to try again. */
export function LoadError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}
