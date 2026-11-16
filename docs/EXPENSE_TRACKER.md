# Expense Tracker

The app's start screen (first item in the side drawer). Track spending by hand or pay a
merchant's UPI QR code through a UPI app the user already has. Everything is stored on the
device; nothing is sent anywhere.

## Sections

| Tab | What it shows |
|---|---|
| **Overview** | Spent today · spent this month · transactions this month · monthly budget (tap to set), budget progress, payments awaiting confirmation, recent transactions |
| **Add** | Amount · category · description · payment method · date & time → *Save expense*, or *Scan QR & Pay* |
| **History** | Search (merchant, note, UPI ID, category, amount) and filters (category, method, status, date range); tap a row to edit, change status or delete (with confirmation) |
| **Analytics** | Daily (7 days) / weekly (8 weeks) / monthly (6 months) trend; category-wise and method-wise breakdown for this month or all time |

## Scan QR & Pay

1. The user fills amount (optional), category and description on **Add**, then taps *Scan QR & Pay*.
2. Camera permission is asked (reuses Utility's ML Kit scanner, `features/utility` barrel).
3. The QR text goes through `services/upi.ts → parseUpiQr`:
   - only `upi://pay?…` is accepted; `pa` must be a well-formed UPI ID;
   - `am` must be a positive amount with ≤ 2 decimals; `cu`, if present, must be `INR`;
   - repeated `pa`/`am` are rejected as ambiguous; `pn` is stripped of control/bidi
     characters; malformed `mc`/`tr` are dropped; every other parameter is ignored.
   The QR can also come from an image: *Upload QR from gallery* opens the system photo picker
   (no storage permission) and ML Kit reads the QR on the device (`NativeExpense.pickQrImage`).
4. If the QR and the user both give an amount and they differ, the user picks one. If neither
   does, the user types it. A **signed** QR (`sign=`) is always paid at its own amount.
5. `buildUpiUri` hands over the QR's own parameters **as scanned** (`mode`, `purpose`, `orgid`,
   `sign`, …) — UPI apps check them and reject an altered signed QR. Only `am` is set (when
   missing, or the user's amount on an unsigned QR), and `cu=INR` / `tn` are added if missing.
6. `NativeExpense.getUpiApps` lists the installed UPI apps. Android 11+ package visibility needs
   `<data android:scheme="upi" android:host="pay" />` in the manifest `<queries>` — without the
   host, UPI apps stay hidden. *Other UPI app* opens Android's own chooser as a fallback.
7. The user picks **how** to pay:
   - **Pay link** — the UPI app opens with payee and amount filled (`launchUpiApp`). Default for
     merchant QRs.
   - **Scan in app** — the UPI app's home opens (`openUpiApp`) and the user scans the QR there.
     Default for personal QRs (no merchant code, or `mc=0000`): Google Pay and PhonePe often
     decline a payment to a person that another app started (e.g. PhonePe's "pay up to ₹2,000
     with QR codes via gallery", Google Pay's "money has not been debited"), but not from their
     own scanner.
   Before the UPI app opens, the expense is saved as **pending** and its id is stored as
   `awaitingConfirmationId`.
8. When the user returns, a sheet asks *Did the payment go through?* — **Payment successful /
   Pending / Payment failed**. Only *successful* marks it `paid`.

### Business rules

- **No gateway, no credentials, no fake confirmation.** The UPI PIN is entered in the UPI app.
  The UPI app's own `Status=` response, when present, is shown only as a hint ("isn't proof of
  payment"); the user's answer decides the status.
- Only `paid` expenses count as spending (summary, budget, analytics). `pending` is shown
  separately; `failed` is excluded.
- If the UPI app can't be opened, the pending record is deleted (no money can have moved).
- **Lifecycle:** the confirmation question survives Android killing the app while the UPI app is
  in front (it is re-asked on next launch from `awaitingConfirmationId`). If a UPI app returns
  without a result, the question is asked 1.5 s after the app becomes active again, and *I'm
  back* is always available.
- Closing the confirmation sheet keeps the payment pending; it can be updated from History.
- After a pay link, the confirmation offers *Didn't work? Scan in <app>*, which reopens that
  app for scanning and keeps the same pending record.
- Amounts are integer paise (₹1 = 100). Limits: > ₹0 and ≤ ₹1 crore. Dates can't be in the future.

## Storage (MMKV — the app's existing local database)

| Key (`StorageKeys`) | "Table" | Row |
|---|---|---|
| `ExpenseRecords` `expense.records` | `expenses` | `id, amount, categoryId, description, merchantName, merchantUpiId, paymentMethod, status, transactionDate, createdAt, updatedAt` |
| `ExpenseCategories` `expense.categories` | `expense_categories` | `id, name, icon, color, isDefault, createdAt` |
| `ExpenseSettings` `expense.settings` | — | `monthlyBudget, awaitingConfirmationId` |
| `ExpenseMeta` `expense.meta` | — | `schemaVersion` |

**Migrations** (`store/expense.store.ts`): records are validated on load (bad rows dropped,
never a crash); built-in categories are merged in by id when missing; user rows are kept; an
expense whose category no longer exists moves to *Other*. Only the four keys above are ever
written — no other feature's data is read or touched.

**Categories:** 12 built-ins (names translated via `expense.cat_<id>`) are fixed. Custom ones
can be added, edited (name, colour, icon) and deleted; their expenses move to *Other*. Names
must be unique, including against the built-in names.

## Native module

`src/specs/NativeExpense.ts` ↔ `android/.../expense/ExpenseModule.kt`

- `getUpiApps(uri)` → JSON `[{packageName, label, icon}]` (icon = PNG data URI).
- `launchUpiApp(uri, packageName)` → JSON `{result: 'ok'|'cancelled', response}`; rejects
  `invalid_uri` / `no_app` / `no_activity` / `launch_failed`. The link must be `upi://pay` with
  a `pa`, and the package must be one Android lists as a UPI handler.
- `launchUpiChooser(uri, title)` — same, through Android's app chooser.
- `openUpiApp(packageName)` — opens a UPI handler's home screen (for *Scan in app*).
- `pickQrImage()` → the QR text in a picked image, `''` if cancelled; rejects `no_qr` /
  `image_failed`.

No new permission (camera was already declared for Utility). Links and UPI responses are
never logged.

## Dependencies

None added. Reuses: Utility's scanner and camera permission; Life's `FormField`, `DateField`,
`ColorPicker`, `StatCard`, `ProgressBar`, `Avatar`, `BarChart`, `HBars`; Follow Up's
`Sheet`, `Chip`, `ChipRow`, `Field`, `useNow`, time helpers. New Lucide icons were added to
`shared/assets/icons`.

## Known limitations

- Android only (the UPI module is absent on iOS; the app lists no UPI apps there).
- The app can't verify a payment — by design, the user confirms it.
- Person-to-person pay links are subject to each UPI app's own restrictions, which the app
  can't change; *Scan in app* is the reliable path for those.
- Single currency (INR).
- Strings are English only, like the rest of the app (`en.json`).
