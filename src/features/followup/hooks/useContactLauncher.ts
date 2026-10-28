import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  openDialer,
  openWhatsApp,
  type LaunchResult,
} from '../services/contactActions';
import type { Contact, FollowUpActivity } from '../types';

export interface PendingInteraction {
  contact: Contact;
  /** The follow-up the user was acting on, if any. */
  activity: FollowUpActivity | null;
  channel: 'call' | 'whatsapp';
}

/**
 * Call / WhatsApp with a "how did it go?" prompt once the user comes back
 * to the app. Opening the dialer or a chat proves nothing about the outcome,
 * so the app asks instead of assuming.
 */
export function useContactLauncher() {
  const [prompt, setPrompt] = useState<PendingInteraction | null>(null);
  const [failure, setFailure] = useState<LaunchResult | null>(null);
  const pending = useRef<PendingInteraction | null>(null);
  const leftApp = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        if (pending.current) leftApp.current = true;
        return;
      }
      if (pending.current && leftApp.current) {
        setPrompt(pending.current);
        pending.current = null;
        leftApp.current = false;
      }
    });
    return () => sub.remove();
  }, []);

  const launch = useCallback(
    async (
      channel: 'call' | 'whatsapp',
      contact: Contact,
      activity: FollowUpActivity | null = null,
      message?: string,
    ) => {
      setFailure(null);
      pending.current = { contact, activity, channel };
      leftApp.current = false;
      const result =
        channel === 'call'
          ? await openDialer(contact)
          : await openWhatsApp(contact, message);
      if (result !== 'opened') {
        pending.current = null;
        setFailure(result);
      }
      return result;
    },
    [],
  );

  return {
    call: (contact: Contact, activity?: FollowUpActivity | null) =>
      launch('call', contact, activity ?? null),
    whatsapp: (
      contact: Contact,
      activity?: FollowUpActivity | null,
      message?: string,
    ) => launch('whatsapp', contact, activity ?? null, message),
    prompt,
    dismissPrompt: () => setPrompt(null),
    failure,
    clearFailure: () => setFailure(null),
  };
}
