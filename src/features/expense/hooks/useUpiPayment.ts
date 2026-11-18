import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ensureCamera,
  openAppSettings,
  utilityNative,
  UtilityError,
} from '@/features/utility';
import {
  ExpenseNativeError,
  upiNative,
  type UpiApp,
} from '../services/native.service';
import {
  buildUpiUri,
  parseUpiQr,
  type UpiParseError,
  type UpiPayee,
} from '../services/upi';
import { expenseStore } from '../store/expense.store';
import type { Expense } from '../types';
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

export interface UpiPayment {
  step: PayStep;
  problem: PayProblem | null;
  /** Scan the QR with the camera. */
  start: (request: PayRequest) => Promise<void>;
  /** Read the QR from an image in the gallery. */
  startFromGallery: (request: PayRequest) => Promise<void>;
  pickAmount: (amount: number) => void;
  /**
   * Records the payment as `paid` and opens [app] (or Android's app chooser
   * when null). Resolves to the saved expense, or null when the UPI app
   * could not be opened (the record is then dropped).
   */
  pay: (app: UpiApp | null, how?: PayHow) => Promise<Expense | null>;
  cancel: () => void;
  clearProblem: () => void;
  openSettings: () => void;
}

/**
 * Scan QR & Pay. The QR is parsed and validated, the user picks the amount
 * if the QR and their entry disagree, then picks a UPI app. Choosing an app
 * records the expense as `paid` and redirects to that app; whatever happens
 * there (success or failure) the record stays `paid` — it can be edited
 * from History.
 */
export function useUpiPayment(): UpiPayment {
  const { t } = useTranslation();
  const [step, setStep] = useState<PayStep>({ kind: 'idle' });
  const [problem, setProblem] = useState<PayProblem | null>(null);
  const request = useRef<PayRequest | null>(null);

  // Older versions asked "did it go through?" after the UPI app; that
  // question is gone, so forget any one left over.
  useEffect(() => {
    if (expenseStore.read().settings.awaitingConfirmationId)
      expenseStore.setAwaitingConfirmation('');
  }, []);

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

  const pay = async (
    app: UpiApp | null,
    how: PayHow = 'link',
  ): Promise<Expense | null> => {
    if (step.kind !== 'chooseApp' || !request.current) return null;
    const { payee, amount, uri } = step;
    const created = expenseActions.createExpense({
      amount,
      categoryId: request.current.categoryId,
      description: request.current.description,
      paymentMethod: 'upi',
      // Recorded as paid as soon as the user is sent to the UPI app,
      // whatever the app reports afterwards.
      status: 'paid',
      transactionDate: new Date().toISOString(),
      merchantName: payee.name,
      merchantUpiId: payee.upiId,
    });
    setStep({ kind: 'idle' });
    if (!created.ok) {
      setProblem('save_failed');
      return null;
    }
    const expense = created.value;
    try {
      if (how === 'scanInApp' && app) await upiNative.openApp(app.packageName);
      else
        await upiNative.launch(
          uri,
          app?.packageName ?? null,
          t('expense.payWith'),
        );
      return expense;
    } catch (error) {
      // Logged by the service. The UPI app never opened, so there was no
      // redirect and no money can have moved: drop the record.
      expenseActions.deleteExpense(expense.id);
      const code =
        error instanceof ExpenseNativeError ? error.code : 'launch_failed';
      setProblem(code === 'no_app' ? 'no_app' : 'launch_failed');
      return null;
    }
  };

  const cancel = () => setStep({ kind: 'idle' });

  return {
    step,
    problem,
    start,
    startFromGallery,
    pickAmount,
    pay,
    cancel,
    clearProblem: () => setProblem(null),
    openSettings: openAppSettings,
  };
}
