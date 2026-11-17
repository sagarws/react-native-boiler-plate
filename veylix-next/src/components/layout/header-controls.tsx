// @ts-nocheck
import { Icon } from "@/components/icons/icon";

export function MobileMenuButton() {
  return (
    <button
      type="button"
      className="icon-button mobile-menu"
      data-action="toggle-sidebar"
      aria-label="Open navigation"
      aria-expanded="false"
    >
      <Icon name="list" />
    </button>
  );
}

export function SearchTrigger() {
  return (
    <button
      type="button"
      className="search-trigger"
      data-action="search"
      aria-label="Search orders, products, customers"
    >
      <Icon name="search" />
      <span>Search orders, products, customers...</span>
      <kbd>⌘ K</kbd>
    </button>
  );
}
