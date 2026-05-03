"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import useSWR from "swr";
import { useStudents, useApplications, mutateApplications } from "@/hooks/use-api";
import { useReapplyFamilyProgress } from "@/hooks/use-reapply-family-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { OptionSelect } from "@/components/option-select";
import { Field, FieldLabel } from "@/components/ui/field";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Student {
  id: number;
  first_name: string;
  last_name: string;
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  is_bus_transportation?: boolean;
  bus_stop?: string;
}

interface BusStop {
  id: number;
  name: string;
}

interface StudentTransport {
  applicationId: number;
  studentId: number;
  studentName: string;
  isBus: boolean;
  busStop: string;
}

/**
 * Re-application step: Transportation.
 *
 * Per-student toggle for bus transportation + bus-stop picker. Writes
 * back to the existing per-year `registration_application` row so the
 * downstream registration phase already has the correct prefs. When all
 * rows are saved without errors, flips `isTransportation: true` on the
 * reapply progress row.
 */
export default function ReapplyTransportationPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);

  const { data: studentsData } = useStudents();
  const { data: applicationsData } = useApplications();
  const { data: busStopsData } = useSWR<BusStop[]>("/api/bus-stops", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });
  const { progress, setSection } = useReapplyFamilyProgress(yearId);

  const enrolled = useMemo<StudentTransport[]>(() => {
    if (!studentsData || !applicationsData) return [];
    const apps = (applicationsData as Application[]).filter(
      (a) => a.registration_school_years_id === yearId
    );
    return apps
      .map((app) => {
        const student = (studentsData as Student[]).find(
          (s) => s.id === app.registration_students_id
        );
        if (!student) return null;
        return {
          applicationId: app.id,
          studentId: student.id,
          studentName: `${student.first_name} ${student.last_name}`,
          isBus: !!app.is_bus_transportation,
          busStop: app.bus_stop ?? "",
        };
      })
      .filter((x): x is StudentTransport => x !== null);
  }, [studentsData, applicationsData, yearId]);

  // Local edit state — populated from the application rows on first load.
  const [transports, setTransports] = useState<StudentTransport[]>([]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!hydrated && enrolled.length > 0) {
      setTransports(enrolled);
      setHydrated(true);
    }
  }, [enrolled, hydrated]);

  const isComplete = !!progress?.isTransportation;
  const [saving, setSaving] = useState(false);

  const busStopOptions = useMemo(
    () =>
      (busStopsData ?? []).map((s) => ({ value: s.name, label: s.name })),
    [busStopsData]
  );

  function update(idx: number, field: "isBus" | "busStop", value: boolean | string) {
    setTransports((prev) =>
      prev.map((t, i) => {
        if (i !== idx) return t;
        if (field === "isBus") {
          return {
            ...t,
            isBus: value as boolean,
            // Clear the stop when the parent disables bus transport.
            busStop: value ? t.busStop : "",
          };
        }
        return { ...t, busStop: value as string };
      })
    );
  }

  async function handleSaveAndConfirm() {
    setSaving(true);
    try {
      // PATCH each application row with the parent's transport choice.
      const results = await Promise.all(
        transports.map((t) =>
          fetch(`/api/applications/${t.applicationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              is_bus_transportation: t.isBus,
              bus_stop: t.isBus ? t.busStop : "",
            }),
          })
        )
      );
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const body = await failed.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${failed.status})`);
      }
      await mutateApplications();
      // Validate: any student with bus enabled needs a stop selected.
      const incomplete = transports.find((t) => t.isBus && !t.busStop);
      if (incomplete) {
        toast.error(
          `Choose a bus stop for ${incomplete.studentName} before confirming.`
        );
        return;
      }
      await setSection("isTransportation", true);
      toast.success("Transportation preferences saved.");
      router.push(`/reapply/year/${yearId}`);
    } catch (err) {
      console.error("Failed to save transportation:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't save — please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  const loading =
    !studentsData || !applicationsData || busStopsData === undefined || progress === null;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <div className="border-b pb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Re-Application — Step 4 of 4
        </p>
        <h1 className="text-2xl font-semibold mt-1">Transportation preferences</h1>
        <p className="text-sm text-muted-foreground mt-1">
          For each student, choose whether they&rsquo;ll ride the bus this
          year. If yes, pick the stop closest to your home.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : transports.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">
          No students returning this year.
        </div>
      ) : (
        <div className="space-y-4">
          {transports.map((t, idx) => (
            <div
              key={t.studentId}
              className="rounded-xl bg-white border p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{t.studentName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.isBus
                      ? "Bus transportation enabled"
                      : "Self transportation"}
                  </p>
                </div>
                <Switch
                  checked={t.isBus}
                  onCheckedChange={(v) => update(idx, "isBus", v)}
                  aria-label="Bus transportation"
                />
              </div>
              {t.isBus ? (
                <Field>
                  <FieldLabel className="text-xs">
                    Bus Stop <span className="text-red-400">*</span>
                  </FieldLabel>
                  <OptionSelect
                    options={busStopOptions}
                    value={t.busStop}
                    onChange={(v) => update(idx, "busStop", v)}
                    placeholder="Select a stop"
                    invalid={!t.busStop}
                  />
                </Field>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          onClick={handleSaveAndConfirm}
          disabled={saving || loading}
          className="min-w-40"
        >
          {saving
            ? "Saving…"
            : isComplete
              ? "Save & Update"
              : "Save & Confirm"}
        </Button>
      </div>
    </div>
  );
}
