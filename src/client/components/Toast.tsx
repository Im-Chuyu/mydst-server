import { AlertCircle, CheckCircle2, X } from "lucide-react";

export interface ToastState {
  type: "success" | "error";
  message: string;
}

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.type}`} role="status">
      {toast.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <span>{toast.message}</span>
      <button className="icon-button compact" onClick={onClose} aria-label="关闭提示"><X size={16} /></button>
    </div>
  );
}
