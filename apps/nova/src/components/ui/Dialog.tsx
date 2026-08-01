import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * Controlled modal dialog built on the native `<dialog>` element with
 * daisyUI modal styling. Renders the `open` attribute (no `showModal()`
 * dependency), so it works in jsdom tests as well as browsers.
 */
export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <dialog
      open={open || undefined}
      className={cn("modal", open && "modal-open", "bg-base-300/60")}
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(event) => {
        // Close when the backdrop (not the panel) is clicked.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={cn("modal-box", className)}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-black">
            {title}
          </h2>
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
