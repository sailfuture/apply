"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Per-section editor on the admin registration detail flow. Routed
 * by the `[section]` slug in the URL — Tuition / Enrollment /
 * Registration / Volunteer Hours all share this single page,
 * branched on the slug.
 *
 * Mirrors the apply-flow's `/admin/families/[id]/[section]` route
 * shape so the Edit button on each registration section card has a
 * predictable destination. Today this is a placeholder shell — the
 * editor for each registration section needs more design (admin
 * usually shouldn't edit signed PandaDocs or signature blobs
 * in-band), so the page surfaces the section's read-only context +
 * a Back button rather than mutable inputs.
 *
 * When the editor for a specific section gets built out, branch on
 * `slug` here and render the corresponding form. Examples:
 *   - tuition       → re-send tuition acknowledgment, override
 *                     monthly payment snapshot, void signature
 *   - enrollment    → re-send PandaDoc, mark agreement signed,
 *                     upload signed PDF on parent's behalf
 *   - registration  → bulk-edit medical fields across students
 *   - volunteer     → reset name + signature, re-send template
 */
export default function RegistrationSectionEditorPage() {
  const params = useParams<{ id: string; section: string }>();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const familyId = Number(params.id);
  const slug = (params.section ?? "").toLowerCase();
  const config = SECTION_CONFIG[slug] ?? UNKNOWN_SECTION;

  const backHref = yearId
    ? `/admin/registrations/${familyId}?yearId=${yearId}#${config.anchor}`
    : `/admin/registrations/${familyId}#${config.anchor}`;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3" />
        Back to registration overview
      </Link>

      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-4 border-b">
          <CardTitle className="text-base">{config.title}</CardTitle>
        </CardHeader>
        <CardContent className="py-8 px-6 bg-white space-y-3 text-sm">
          <p className="text-muted-foreground">
            Per-section admin editor for{" "}
            <span className="font-medium text-foreground">
              {config.title}
            </span>{" "}
            isn&rsquo;t built out yet. The registration overview
            already exposes the read-only state of this section + the
            Verify and Notes affordances; once the field-level
            override UX lands here, this shell will be replaced.
          </p>
          <p className="text-muted-foreground">
            For now, head back to the registration overview and use
            the section&rsquo;s Notes drawer for any context that
            needs to be tracked.
          </p>
          <div className="pt-4">
            <Button asChild variant="outline" size="sm" className="bg-white">
              <Link href={backHref}>
                <ArrowLeft className="size-4 mr-1.5" />
                Return to overview
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Title + scroll-anchor for each known section slug. The anchor
 * matches the `<section id="…">` ids on the registration overview
 * so the back link returns the user right to the card they came
 * from.
 */
const SECTION_CONFIG: Record<
  string,
  { title: string; anchor: string }
> = {
  tuition: { title: "Tuition", anchor: "section-tuition" },
  enrollment: {
    title: "Enrollment Agreement",
    anchor: "section-enrollment",
  },
  registration: {
    title: "Registration Packet",
    anchor: "section-registration",
  },
  volunteer: {
    title: "Volunteer Hours",
    anchor: "section-volunteer",
  },
};

const UNKNOWN_SECTION = { title: "Section", anchor: "" };
