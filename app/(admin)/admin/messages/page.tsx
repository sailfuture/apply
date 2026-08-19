"use client";

import { MessagesInbox } from "@/components/admin/messages-inbox";

/**
 * Messages — the ENROLLED families inbox (Parents → Messages).
 * Filters by crew, bus stop, and grade; the group composer
 * is scoped to enrolled families. Everyone still in the funnel —
 * leads and applying/registering families — lives on
 * /admin/messages/recruitment (Recruitment → Messages); deep links
 * that land on the wrong page redirect to the right one. The split,
 * the shared inbox, and both scopes live in
 * components/admin/messages-inbox.tsx.
 */
export default function AdminMessagesPage() {
  return <MessagesInbox mode="enrolled" />;
}
