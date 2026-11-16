import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  ensureCamera,
  openAppSettings,
  utilityNative,
  UtilityError,
} from '@/features/utility';
import { logger } from '@/shared/utils';
import {
  ExpenseNativeError,
  upiNative,
  type UpiApp,
} from '../services/native.service';
import {
  buildUpiUri,
  parseUpiQr,
  parseUpiResponse,
  type UpiAppReport,
  type UpiParseError,
  type UpiPayee,
} from '../services/upi';
import { expenseStore } from '../store/expense.store';
import type { Expense, TransactionStatus } from '../types';
import { parseAmount } from '../utils/money';
import { expenseActions } from './useExpense';

export type PayProblem =
  | 'camera_denied'
  | 'camera_blocked'
  | 'camera_unavailable'
  | 'camera_failed'
  | 'amount_invalid'
  | 'save_failed'
  | 'no_app'
  | 'launch_failed'
  | 'gallery_no_qr'
  | 'gallery_failed'
  | UpiParseError;

export type PayStep =
  | { kind: 'idle' }
  /** Camera scanner or photo picker is open. */
  | { kind: 'scanning' }
  /** The QR and the user both named an amount, and they differ. */
  | {
      kind: 'chooseAmount';
      payee: UpiPayee;
      qrAmount: number;
      enteredAmount: number;
    }
  /** Neither the user nor the QR gave an amount. */
  | { kind: 'enterAmount'; payee: UpiPayee }
  | { kind: 'loadingApps' }
  | {
      kind: 'chooseApp';
      payee: UpiPayee;
      amount: number;
      uri: string;
      apps: UpiApp[];
    }
  /** The UPI app is in front; waiting for the user to come back. */
  | { kind: 'launching'; expenseId: string; app: UpiApp | null }
  /** Back from the UPI app: the user says what happened. */
  | {
      kind: 'confirm';
      expenseId: string;
      report: UpiAppReport;
      /** The app used, so the user can retry by scanning in it. */
      app: UpiApp | null;
    };

/**
 * `link` hands the payment link to the UPI app. `scanInApp` opens the UPI
 * app's home so the user scans the QR there — UPI apps often restrict
 * payments to a person when another app starts them, but not from their
 * own scanner.
 */
export type PayHow = 'link' | 'scanInApp';

export interface PayRequest {
  /** The amount field as typed; may be empty (the QR may carry it). */
  amountText: string;
  categoryId: string;
  description: string;
}

/** How long after returning to the app before we stop waiting for the UPI
 *  app's result and ask the user directly. */
const RETURN_GRACE_MS = 1500;

export interface UpiPayment {
  step: PayStep;
  problem: PayProblem | null;
  /** The expense being confirmed (for the confirmation sheet). */
  confirming: Expense | undefined;
  /** Scan the QR with the camera. */
  start: (request: PayRequest) => Promise<void>;
  /** Read the QR from an image in the gallery. */
  startFromGallery: (request: PayRequest) => Promise<void>;
  pickAmount: (amount: number) => void;
  /** Pays with [app], or with Android's app chooser when null. */
  pay: (app: UpiApp | null, how?: PayHow) => Promise<void>;
  /** From the confirmation: the link failed, so scan in the same app. */
  scanInAppInstead: () => Promise<void>;
  /** "I'm back" while waiting on the UPI app. */
  returned: () => void;
  /** Records the user's answer; only `paid` marks it paid. */
  confirm: (status: TransactionStatus) => Expense | null;
  cancel: () => void;
  clearProblem: () => void;
  openSettings: () => void;
}

/**
 * Scan QR & Pay. The QR is parsed and validated, the user picks the amount
 * if the QR and their entry disagree, then picks a UPI app. The expense is
 * saved as `pending` *before* the UPI app opens, and the "did it go
 * through?" question is persisted, so it is asked even if Android closes this
 * app meanwhile. Nothing is marked paid until the user says so.
 */
export function useUpiPayment(): UpiPayment {
  const { t } = useTranslation();
  const [step, setStep] = useState<PayStep>({ kind: 'idle' });
  const [problem, setProblem] = useState<PayProblem | null>(null);
  const request = useRef<PayRequest | null>(null);

  // Ask about a payment left unconfirmed (app closed while in the UPI app).
  useEffect(() => {
    const id = expenseStore.read().settings.awaitingConfirmationId;
    if (!id) return;
    if (expenseStore.find(id))
      setStep({ kind: 'confirm', expenseId: id, report: 'unknown', app: null });
    else expenseStore.setAwaitingConfirmation('');
  }, []);

  // Back in the app but the UPI app never reported back (some don't): ask.
  useEffect(() => {
    if (step.kind !== 'launching') return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          setStep(cur =>
            cur.kind === 'launching'
              ? {
                  kind: 'confirm',
                  expenseId: cur.expenseId,
                  report: 'unknown',
                  app: cur.app,
                }
              : cur,
          ),
        RETURN_GRACE_MS,
      );
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [step.kind]);

  // The expense being confirmed was deleted (e.g. from history): stop asking.
  const confirmId = step.kind === 'confirm' ? step.expenseId : '';
  useEffect(() => {
    if (!confirmId) return undefined;
    const check = () => {
      if (expenseStore.find(confirmId)) return;
      expenseStore.setAwaitingConfirmation('');
      setStep({ kind: 'idle' });
    };
    check();
    return expenseStore.subscribe(check);
  }, [confirmId]);

  const toApps = useCallback(async (payee: UpiPayee, amount: number) => {
    const uri = buildUpiUri(payee, amount, request.current?.description ?? '');
    setStep({ kind: 'loadingApps' });
    const apps = await upiNative.apps(uri);
    setStep({ kind: 'chooseApp', payee, amount, uri, apps });
  }, []);

  const withPayee = useCallback(
    (payee: UpiPayee) => {
      const text = request.current?.amountText.trim() ?? '';
      const entered = text ? parseAmount(text) : null;
      const qr = payee.amount;
      // A signed QR is rejected if its amount changes: pay it as it is.
      if (payee.signed && qr !== null) {
        toApps(payee, qr);
        return;
      }
      if (qr !== null && entered !== null && qr !== entered) {
        setStep({
          kind: 'chooseAmount',
          payee,
          qrAmount: qr,
          enteredAmount: entered,
        });
        return;
      }
      const amount = entered ?? qr;
      if (amount === null) setStep({ kind: 'enterAmount', payee });
      else toApps(payee, amount);
    },
    [toApps],
  );

  /** Checks the typed amount and remembers the request; false = stop. */
  const begin = (req: PayRequest): boolean => {
    if (step.kind !== 'idle') return false;
    setProblem(null);
    // A typed amount must be valid before the camera / gallery opens.
    if (req.amountText.trim() && parseAmount(req.amountText) === null) {
      setProblem('amount_invalid');
      return false;
    }
    request.current = req;
    return true;
  };

  /** QR text from the camera or an image → validated payee → next step. */
  const fromQrText = (value: string | null) => {
    if (value === null) {
      setStep({ kind: 'idle' });
      return;
    }
    const parsed = parseUpiQr(value);
    if (!parsed.ok) {
      setProblem(parsed.error);
      setStep({ kind: 'idle' });
      return;
    }
    withPayee(parsed.payee);
  };

  const start = async (req: PayRequest) => {
    if (!begin(req)) return;
    const access = await ensureCamera();
    if (access !== 'granted') {
      setProblem(
        access === 'blocked'
          ? 'camera_blocked'
          : access === 'denied'
          ? 'camera_denied'
          : 'camera_unavailable',
      );
      return;
    }
    setStep({ kind: 'scanning' });
    let value: string | null = null;
    try {
      const result = await utilityNative.scanBarcode({
        close: t('common.close'),
        aim: t('expense.scanAim'),
        pause: t('utility.scanPause'),
        resume: t('utility.scanResume'),
        paused: t('utility.scanPaused'),
        torchOn: t('utility.torchOn'),
        torchOff: t('utility.torchOff'),
      });
      value = result?.value ?? null;
    } catch (error) {
      const code = error instanceof UtilityError ? error.code : 'camera_failed';
      setProblem(
        code === 'camera_permission'
          ? 'camera_denied'
          : code === 'unavailable'
          ? 'camera_unavailable'
          : 'camera_failed',
      );
    }
    fromQrText(value);
  };

  const startFromGallery = async (req: PayRequest) => {
    if (!begin(req)) return;
    setStep({ kind: 'scanning' });
    let value: string | null = null;
    try {
      value = await upiNative.pickQrImage();
    } catch (error) {
      const code = error instanceof ExpenseNativeError ? error.code : '';
      setProblem(code === 'no_qr' ? 'gallery_no_qr' : 'gallery_failed');
    }
    fromQrText(value);
  };

  const pickAmount = (amount: number) => {
    if (step.kind === 'chooseAmount' || step.kind === 'enterAmount') {
      toApps(step.payee, amount);
    }
  };

  const pay = async (app: UpiApp | null, how: PayHow = 'link') => {
    if (step.kind !== 'chooseApp' || !request.current) return;
    const { payee, amount, uri } = step;
    const created = expenseActions.createExpense({
      amount,
      categoryId: request.current.categoryId,
      description: request.current.description,
      paymentMethod: 'upi',
      status: 'pending',
      transactionDate: new Date().toISOString(),
      merchantName: payee.name,
      merchantUpiId: payee.upiId,
    });
    if (!created.ok) {
      setProblem('save_failed');
      setStep({ kind: 'idle' });
      return;
    }
    const id = created.value.id;
    expenseStore.setAwaitingConfirmation(id);
    setStep({ kind: 'launching', expenseId: id, app });
    if (how === 'scanInApp' && app) {
      try {
        // No result comes back from the app's home screen: the return to
        // this app (AppState) brings up the confirmation.
        await upiNative.openApp(app.packageName);
      } catch {
        // Logged by the service. The app never opened: drop the draft.
        expenseActions.deleteExpense(id);
        setProblem('launch_failed');
        setStep({ kind: 'idle' });
      }
      return;
    }
    try {
      const { response } = await upiNative.launch(
        uri,
        app?.packageName ?? null,
        t('expense.payWith'),
      );
      const report = parseUpiResponse(response);
      setStep(cur =>
        (cur.kind === 'launching' || cur.kind === 'confirm') &&
        cur.expenseId === id
          ? { kind: 'confirm', expenseId: id, report, app }
          : cur,
      );
    } catch (error) {
      // The UPI app never opened, so no money can have moved: drop the draft.
      expenseActions.deleteExpense(id);
      const code =
        error instanceof ExpenseNativeError ? error.code : 'launch_failed';
      setProblem(code === 'no_app' ? 'no_app' : 'launch_failed');
      setStep({ kind: 'idle' });
    }
  };

  const returned = () =>
    setStep(cur =>
      cur.kind === 'launching'
        ? {
            kind: 'confirm',
            expenseId: cur.expenseId,
            report: 'unknown',
            app: cur.app,
          }
        : cur,
    );

  const scanInAppInstead = async () => {
    if (step.kind !== 'confirm' || !step.app) return;
    const { expenseId, app } = step;
    setStep({ kind: 'launching', expenseId, app });
    try {
      await upiNative.openApp(app.packageName);
    } catch {
      // Logged by the service. Couldn't open it: back to the question, the record stays pending.
      setStep({ kind: 'confirm', expenseId, report: 'unknown', app });
    }
  };

  const confirm = (status: TransactionStatus): Expense | null => {
    if (step.kind !== 'confirm') return null;
    const result = expenseActions.setStatus(step.expenseId, status);
    expenseStore.setAwaitingConfirmation('');
    setStep({ kind: 'idle' });
    if (!result.ok) {
      logger.warn('payment status could not be saved', result.error);
      return null;
    }
    return result.value;
  };

  const cancel = () => {
    if (step.kind === 'confirm' || step.kind === 'launching') return;
    setStep({ kind: 'idle' });
  };

  const confirming =
    step.kind === 'confirm' ? expenseStore.find(step.expenseId) : undefined;

  return {
    step,
    problem,
    confirming,
    start,
    startFromGallery,
    pickAmount,
    pay,
    scanInAppInstead,
    returned,
    confirm,
    cancel,
    clearProblem: () => setProblem(null),
    openSettings: openAppSettings,
  };
}
