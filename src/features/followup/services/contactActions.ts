import { Linking } from 'react-native';
import { logger } from '@/shared/utils';
import { followUpStore } from '../store/followup.store';
import type { Contact } from '../types';
import { telUrl, whatsappUrl } from '../utils/phone';

export type LaunchResult = 'opened' | 'no_number' | 'unavailable';

/**
 * Opens the dialer with the contact's number (the user still taps Call
 * there — nothing is dialled silently). Records "dialer opened" in the
 * timeline; whether the call happened is for the user to log.
 */
export async function openDialer(contact: Contact): Promise<LaunchResult> {
  if (!contact.e164) return 'no_number';
  try {
    await Linking.openURL(telUrl(contact.e164));
    followUpStore.logEvent(contact.id, 'dialer_opened');
    return 'opened';
  } catch (error) {
    logger.warn('dialer could not be opened', (error as Error)?.message);
    return 'unavailable';
  }
}

/**
 * Opens a WhatsApp chat via the official wa.me link, with [message]
 * pre-filled when given. Nothing is sent automatically, and opening the chat
 * doesn't mean a message was sent. Without WhatsApp the link opens in a
 * browser if there is one; with neither it fails and says so.
 */
export async function openWhatsApp(
  contact: Contact,
  message?: string,
): Promise<LaunchResult> {
  if (!contact.e164) return 'no_number';
  try {
    await Linking.openURL(whatsappUrl(contact.e164, message));
    followUpStore.logEvent(contact.id, 'whatsapp_opened');
    return 'opened';
  } catch (error) {
    logger.warn('WhatsApp link could not be opened', (error as Error)?.message);
    return 'unavailable';
  }
}

/** Opens the mail app addressed to the contact. */
export async function openEmail(email: string): Promise<LaunchResult> {
  if (!email) return 'no_number';
  try {
    await Linking.openURL(`mailto:${encodeURIComponent(email)}`);
    return 'opened';
  } catch (error) {
    logger.warn('mail app could not be opened', (error as Error)?.message);
    return 'unavailable';
  }
}
