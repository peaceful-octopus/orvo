import { useToasts, type Toast } from './toastStore';

/** One message, as shown in the call window and, while floating, in the controls window. */
export function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss?: () => void }) {
  return (
    <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span>{toast.text}</span>
      {onDismiss && (
        <button className="link" aria-label="Dismiss message" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

/** Messages about things that went wrong, at the top of the window. */
export function Toasts() {
  const { toasts, dismiss } = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}
