"use client";

import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Calendar } from "lucide-react";

/**
 * Cards shared by the dashboard's mid-year add-student flows — the
 * residential placement page and the sibling application — so both ask
 * for exactly the same student details and NWEA scheduling.
 */

/** The application fields these cards edit. */
export interface StudentApplicationFields {
  current_previous_school: string;
  last_grade_completed: string;
  current_grade: string;
  describe_student_strengths: string;
  describe_student_opportunities_for_growth: string;
  is_bus_transportation: boolean;
  bus_stop: string;
  nwea_testing_scheduled?: boolean;
  nwea_testing_complete?: boolean;
}

export interface BusStop {
  id: number;
  name: string;
  address: string;
}

export type SetField = <K extends keyof StudentApplicationFields>(
  key: K,
  value: StudentApplicationFields[K]
) => void;

/** School history, strengths / growth, and transportation. */
export function StudentDetailsCard({
  app,
  setField,
  busStops,
}: {
  app: StudentApplicationFields;
  setField: SetField;
  busStops: BusStop[];
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">Student Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
          <Field>
            <FieldLabel className="text-xs">
              Current / Previous School
            </FieldLabel>
            <Input
              className={!app.current_previous_school ? "border-2 border-red-400" : ""}
              placeholder="School name"
              value={app.current_previous_school}
              onChange={(e) => setField("current_previous_school", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel className="text-xs">Current Grade</FieldLabel>
            <Input
              className={!app.last_grade_completed ? "border-2 border-red-400" : ""}
              placeholder="e.g. 7th"
              value={app.last_grade_completed}
              onChange={(e) => setField("last_grade_completed", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel className="text-xs">Incoming Grade</FieldLabel>
            <Input
              className={!app.current_grade ? "border-2 border-red-400" : ""}
              placeholder="e.g. 8th"
              value={app.current_grade}
              onChange={(e) => setField("current_grade", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel className="text-xs">
              Describe Student Strengths
            </FieldLabel>
            <textarea
              className={`flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                !app.describe_student_strengths
                  ? "border-2 border-red-400"
                  : "border-input"
              }`}
              placeholder="Student's strengths..."
              value={app.describe_student_strengths}
              onChange={(e) =>
                setField("describe_student_strengths", e.target.value)
              }
            />
          </Field>
          <Field>
            <FieldLabel className="text-xs">
              Describe Student Opportunities for Growth
            </FieldLabel>
            <textarea
              className={`flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                !app.describe_student_opportunities_for_growth
                  ? "border-2 border-red-400"
                  : "border-input"
              }`}
              placeholder="Areas for growth..."
              value={app.describe_student_opportunities_for_growth}
              onChange={(e) =>
                setField(
                  "describe_student_opportunities_for_growth",
                  e.target.value
                )
              }
            />
          </Field>
        </div>

        <section className="border-t pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Transportation</h3>
            <Switch
              checked={app.is_bus_transportation}
              onCheckedChange={(v) => {
                setField("is_bus_transportation", v);
                if (!v) setField("bus_stop", "");
              }}
              aria-label="Bus transportation"
            />
          </div>
          {app.is_bus_transportation ? (
            <div className="mt-4">
              <Field>
                <FieldLabel className="text-xs">
                  Bus Stop <span className="text-red-400">*</span>
                </FieldLabel>
                <select
                  className={`flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    !app.bus_stop ? "border-red-400" : "border-input"
                  }`}
                  value={app.bus_stop}
                  onChange={(e) => setField("bus_stop", e.target.value)}
                >
                  <option value="">Select a bus stop</option>
                  {busStops.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                      {s.address ? ` — ${s.address}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

/** NWEA initial testing — book a slot, then confirm it's scheduled. */
export function NweaTestingCard({
  app,
  setField,
  onSchedule,
}: {
  app: StudentApplicationFields;
  setField: SetField;
  /** Opens the NWEA booking dialog. */
  onSchedule: () => void;
}) {
  const nweaScheduled = !!(
    app.nwea_testing_scheduled || app.nwea_testing_complete
  );
  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">Initial Testing (NWEA)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 py-5 bg-white dark:bg-background">
        <p className="text-sm text-muted-foreground">
          All applying students complete an NWEA screening in Reading and Math
          at SailFuture Academy (about 60&ndash;90 minutes total). Schedule a
          time, then confirm below.
        </p>
        <Button
          type="button"
          className={`w-full ${
            nweaScheduled
              ? "bg-muted text-muted-foreground hover:bg-muted cursor-default"
              : ""
          }`}
          disabled={nweaScheduled}
          onClick={onSchedule}
        >
          <Calendar className="size-4 mr-1.5 shrink-0" />
          {nweaScheduled
            ? "NWEA Testing Scheduled"
            : "Click to Schedule NWEA Testing"}
        </Button>
        <label
          className={`flex items-start gap-3 cursor-pointer rounded-md border px-4 py-3 transition-colors ${
            nweaScheduled ? "border-input" : "border-2 border-red-400"
          }`}
        >
          <input
            type="checkbox"
            className="size-5 mt-0.5 cursor-pointer rounded accent-primary"
            checked={nweaScheduled}
            onChange={(e) => {
              const v = e.target.checked;
              setField("nwea_testing_scheduled", v);
              setField("nwea_testing_complete", v);
            }}
          />
          <span className="text-sm font-medium">
            Yes, I&rsquo;ve scheduled NWEA testing for my child at SailFuture
            Academy.
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
