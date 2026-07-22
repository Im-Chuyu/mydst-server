import { AlertTriangle, X } from "lucide-react";

export interface ConfirmState {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({ state, onClose }: { state: ConfirmState | null; onClose: () => void }) {
  if (!state) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title"><AlertTriangle size={19} />{state.title}</div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <p>{state.message}</p>
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>取消</button>
          <button className={`button ${state.danger ? "danger" : "primary"}`} onClick={async () => { await state.onConfirm(); onClose(); }}>
            {state.confirmText || "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}
