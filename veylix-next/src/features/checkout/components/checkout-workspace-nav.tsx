// @ts-nocheck
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { checkoutWorkspaceNavItems } from "@/features/checkout/constants";
import { buildHref } from "@/lib/navigation";

export function CheckoutWorkspaceNav() {
  return (
    <nav
      className="checkout-workspace-nav"
      aria-label="Checkout and pricing workspace"
    >
      {checkoutWorkspaceNavItems.map(([e, t, n]) => (
        <Link
          key={e}
          href={buildHref(`/commerce/${e}`)}
          className={e === "checkout" ? "active" : ""}
        >
          <Icon name={n} />
          <span>{t}</span>
        </Link>
      ))}
    </nav>
  );
}
