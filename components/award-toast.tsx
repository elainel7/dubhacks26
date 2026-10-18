"use client";

export function AwardToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4" aria-live="polite">
      {message ? (
        <div
          role="status"
          className="pointer-events-auto flex items-center gap-3 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-[0_16px_40px_rgb(28_36_32_/_0.2)]"
        >
          <p className="font-heading text-lg leading-none">{message}</p>
          <button
            type="button"
            className="rounded-full px-2 py-1 text-sm font-semibold text-primary-foreground/80 hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
