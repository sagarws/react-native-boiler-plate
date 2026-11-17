// @ts-nocheck
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { paymentWorkspaceTabs } from "@/features/payments/constants";
import { buildHref } from "@/lib/navigation";

export function PaymentWorkspaceNav({ active }) {
  return (
    <nav className="payment-workspace-nav" aria-label="Payments workspace">
      {paymentWorkspaceTabs.map(([t, n, r]) => (
        <Link
          key={t}
          href={buildHref(`/commerce/${t}`)}
          className={t === active ? "active" : ""}
        >
          <Icon name={r} />
          <span>{n}</span>
        </Link>
      ))}
    </nav>
  );
}
