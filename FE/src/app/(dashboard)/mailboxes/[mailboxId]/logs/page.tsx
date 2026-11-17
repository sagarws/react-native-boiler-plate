import type { Metadata } from "next";
import { MailboxLogsPage } from "@/features/emails/mailbox-logs-page";

export const metadata: Metadata = { title: "Mailbox Logs" };

export default function Page() {
  return <MailboxLogsPage />;
}
