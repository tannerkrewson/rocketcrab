import type { ReactNode } from "react";
import { Modal } from "@heroui/react";
import { cn } from "../../lib/cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * Controlled HeroUI modal. React Aria owns focus trapping, Escape handling,
 * backdrop dismissal, and the dialog semantics.
 */
export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  return (
    <Modal
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className={cn("max-w-2xl", className)}>
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
              <Modal.CloseTrigger aria-label="Close dialog" />
            </Modal.Header>
            <Modal.Body>{children}</Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
