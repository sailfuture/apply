"use client";

import { ToursPanel } from "@/components/admin/tours-panel";

/**
 * Campus Tours — every scheduled tour in one operational list:
 * staff-scheduled tours (from a lead's triage sheet) and website
 * bookings pulled off the Google appointment schedule by the
 * auto-sync. Deliberately its OWN page, separate from the
 * liability-waiver database at /admin/campus-visits — a waiver is
 * paperwork a visitor signed; a tour is an event on the calendar.
 */
export default function CampusToursPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Campus Tours</h1>
        <p className="text-sm text-muted-foreground">
          Scheduled tours from lead outreach and the website booking
          page, synced with Google Calendar. Schedule new tours from a
          lead&rsquo;s sheet on All Leads.
        </p>
      </div>
      <ToursPanel />
    </div>
  );
}
