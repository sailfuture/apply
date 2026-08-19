"use client";

import { MessagesInbox } from "@/components/admin/messages-inbox";

/**
 * Recruitment Messages — texting for everyone NOT yet enrolled:
 * leads (inquiries, camp, liability-waiver visits, TASCO), ad-hoc
 * numbers, and families still applying or registering. Enrolled
 * families live on /admin/messages (Parents → Messages).
 * Nested under /admin/messages so the nav's unread-badge suppression
 * and the PWA start URL keep working. The shared inbox lives in
 * components/admin/messages-inbox.tsx.
 */
export default function RecruitmentMessagesPage() {
  return <MessagesInbox mode="recruitment" />;
}
