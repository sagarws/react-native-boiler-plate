import { clone, delay } from "@/mocks/delay";
import { sampleBackgroundJobs, sampleNotifications, type BackgroundJobs, type Notifications } from "@/mocks/notifications";
import type { MessageResponse } from "@/types/common";

/** Mock of TrackVid-FE `api/notification-service.ts`. The SSE stream is simulated by `subscribeNotifications`. */

let notifications: Notifications[] = clone(sampleNotifications);

const getAllNotifications = async (): Promise<Notifications[]> => {
  await delay();
  return clone(notifications.filter((n) => !n.is_archived));
};

const getBackgroundJobs = async (): Promise<BackgroundJobs> => {
  await delay();
  return clone(sampleBackgroundJobs);
};

const markAsRead = async (id: string): Promise<MessageResponse> => {
  await delay(150);
  notifications = notifications.map((n) => (n._id === id ? { ...n, is_read: true } : n));
  return { message: "Marked as read" };
};

const markAllAsRead = async (): Promise<MessageResponse> => {
  await delay(200);
  notifications = notifications.map((n) => ({ ...n, is_read: true }));
  return { message: "All notifications marked as read" };
};

const archiveNotification = async (id: string): Promise<MessageResponse> => {
  await delay(200);
  notifications = notifications.map((n) => (n._id === id ? { ...n, is_archived: true } : n));
  return { message: "Notification archived" };
};

/**
 * Stand-in for the `/notifications/sse` EventSource: pushes one new notification after a while.
 * Returns the unsubscribe function (clears the timer).
 */
const subscribeNotifications = (onMessage: (all: Notifications[]) => void): (() => void) => {
  const timer = window.setTimeout(() => {
    const fresh: Notifications = {
      _id: `ntf-live-${Date.now()}`,
      message: "New return received",
      description: "Return video recorded for AWB 7781200459 at Packing Station 2.",
      is_read: false,
      is_archived: false,
      type: "RETURN",
      createdAt: new Date().toISOString(),
    };
    notifications = [fresh, ...notifications];
    onMessage(clone(notifications.filter((n) => !n.is_archived)));
  }, 45000);
  return () => window.clearTimeout(timer);
};

export const NotificationsService = {
  getAllNotifications,
  getBackgroundJobs,
  markAsRead,
  markAllAsRead,
  archiveNotification,
  subscribeNotifications,
};
