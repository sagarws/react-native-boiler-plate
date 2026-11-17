// @ts-nocheck
import { AbandonedCartReviewDialog } from "@/features/orders/components/abandoned-cart-review-dialog";
import { ApproveCancellationDialog } from "@/features/orders/components/approve-cancellation-dialog";
import { CancellationReviewDialog } from "@/features/orders/components/cancellation-review-dialog";
import { CompleteRefundDialog } from "@/features/orders/components/complete-refund-dialog";
import { MarkCartRecoveredDialog } from "@/features/orders/components/mark-cart-recovered-dialog";
import { RefundReviewDialog } from "@/features/orders/components/refund-review-dialog";

export function OrderOperationsDialogHost({
  dialog,
  onClose,
  onEdit,
  onChanged,
  onAdvanceAbandoned,
}) {
  return dialog ? (
    dialog.mode === "review" ? (
      dialog.moduleId === "refunds" ? (
        <RefundReviewDialog
          id={dialog.id}
          onClose={onClose}
          onEdit={() => onEdit("refunds", dialog.id)}
        />
      ) : dialog.moduleId === "cancellations" ? (
        <CancellationReviewDialog
          id={dialog.id}
          onClose={onClose}
          onEdit={() => onEdit("cancellations", dialog.id)}
        />
      ) : (
        <AbandonedCartReviewDialog
          id={dialog.id}
          onClose={onClose}
          onAdvance={() => {
            onClose();
            onAdvanceAbandoned(dialog.id);
          }}
        />
      )
    ) : dialog.mode === "refund-complete" ? (
      <CompleteRefundDialog
        id={dialog.id}
        onClose={onClose}
        onChanged={onChanged}
      />
    ) : dialog.mode === "cancellation-approve" ? (
      <ApproveCancellationDialog
        id={dialog.id}
        onClose={onClose}
        onChanged={onChanged}
      />
    ) : (
      <MarkCartRecoveredDialog
        id={dialog.id}
        onClose={onClose}
        onChanged={onChanged}
      />
    )
  ) : null;
}
