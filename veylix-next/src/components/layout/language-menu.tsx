// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { locales } from "@/i18n/locales";
import { getLocale, setLocale } from "@/i18n/translate";

function LanguageFlag({ locale }) {
  const t = {
    className: "language-flag",
    viewBox: "0 0 30 20",
    "aria-hidden": true,
  };
  return locale === "de" ? (
    <svg {...t}>
      <path fill="#222" d="M0 0h30v7H0z" />
      <path fill="#d7443c" d="M0 7h30v6H0z" />
      <path fill="#f3c74b" d="M0 13h30v7H0z" />
    </svg>
  ) : locale === "fr" ? (
    <svg {...t}>
      <path fill="#284796" d="M0 0h10v20H0z" />
      <path fill="#fff" d="M10 0h10v20H10z" />
      <path fill="#e34a4a" d="M20 0h10v20H20z" />
    </svg>
  ) : locale === "sv" ? (
    <svg {...t}>
      <path fill="#2874a7" d="M0 0h30v20H0z" />
      <path stroke="#f5cf4d" strokeWidth="4" d="M10 0v20M0 10h30" />
    </svg>
  ) : locale === "ar" ? (
    <svg {...t}>
      <path fill="#258653" d="M0 0h30v7H0z" />
      <path fill="#fff" d="M0 7h30v6H0z" />
      <path fill="#242424" d="M0 13h30v7H0z" />
      <path fill="#da4148" d="M0 0h8v20H0z" />
    </svg>
  ) : (
    <svg {...t}>
      <path fill="#243b73" d="M0 0h30v20H0z" />
      <path stroke="#fff" strokeWidth="4" d="m0 0 30 20M30 0 0 20" />
      <path stroke="#d64043" strokeWidth="1.6" d="m0 0 30 20M30 0 0 20" />
      <path stroke="#fff" strokeWidth="7" d="M15 0v20M0 10h30" />
      <path stroke="#d64043" strokeWidth="4" d="M15 0v20M0 10h30" />
    </svg>
  );
}

export function LanguageMenu({ open: e, onToggle, onClose }) {
  const r = getLocale();
  function i(e) {
    setLocale(e);
    onClose(true);
  }
  return (
    <div className="header-menu-wrap">
      <button
        type="button"
        className="icon-button language-trigger"
        data-header-menu="language"
        aria-label="Language"
        aria-haspopup="menu"
        aria-expanded={e}
        aria-controls="header-popover-language"
        onClick={(e) => onToggle(e.currentTarget)}
      >
        <LanguageFlag locale={r} />
      </button>
      {e ? (
        <div
          id="header-popover-language"
          className="header-popover popover-language"
          role="menu"
          aria-label="Language"
        >
          <div className="popover-title">Language</div>
          {locales.map((e) => {
            const t = e.id === r;
            return (
              <button
                key={e.id}
                type="button"
                role="menuitemradio"
                aria-checked={t}
                data-locale={e.id}
                data-no-translate=""
                onClick={() => i(e.id)}
              >
                <LanguageFlag locale={e.id} />
                <span lang={e.id}>{e.name}</span>
                {t ? <Icon name="check-circle" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
