"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { US_STATES } from "@/lib/us-states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, FileUp, X, Loader2, CheckCircle2, Users, Home, Car } from "lucide-react";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";

import { AnimatePresence, motion } from "framer-motion";
import SignatureCanvas from "react-signature-canvas";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
} from "@/components/ui/file-upload";

interface SchoolYear {
  id: number;
  year_name: string;
  scholarship_deadline: string | null;
}

interface Scholarship {
  id: number;
  registration_families_id: number;
  registration_school_years_id: number;
  household_adults: number;
  household_children: number;
  no_contributing_member: boolean;
  business_income_monthly: number;
  capital_gains_monthly: number;
  child_support_monthly: number;
  alimony_monthly: number;
  trusts_monthly: number;
  other_income_monthly: number;
  describe_other_income: string;
  assets_checking: number;
  assets_savings: number;
  assets_retirement_savings: number;
  assets_stocks_bonds_securities: number;
  assets_trusts_inheritance: number;
  assets_business: number;
  debts_credit_cards: number;
  debts_student_loans: number;
  debts_personal_loans: number;
  government_benefits: boolean;
  family_contribution_per_month: number;
  scholarship_advocacy_letter: string;
  snap_benefits: Record<string, unknown> | null;
  signature: Record<string, unknown> | null;
  termination_letter: Record<string, unknown> | null;
  last_edited: number | null;
  isNotParticipating: boolean;
  isSNAPBenefits: boolean;
  isOpportunityScholarship: boolean;
}

interface FullScholarshipResponse {
  opportunity_scholarship: Scholarship;
  homes: Home[];
  vehicles: Vehicle[];
  contributing_members: ContributingMember[];
  benefits: Benefit[];
}

interface ContributingMember {
  id: number;
  first_name: string;
  last_name: string;
  address: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  zipcode: string;
  estimated_annual_income: number;
  isW2: boolean;
  isPayStubs: boolean;
  w2: Record<string, unknown> | null;
  paystub_1: Record<string, unknown> | null;
  paystub_2: Record<string, unknown> | null;
  paystub_3: Record<string, unknown> | null;
  paystub_4: Record<string, unknown> | null;
}

interface Home {
  id: number;
  type: string;
  address: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  zipcode: string;
  total_value: number;
  outstanding_debt: number;
}

interface Vehicle {
  id: number;
  type: string;
  car_make: string;
  car_model: string;
  car_year: string;
  total_value: number;
  remaining_debt: number;
}

interface Benefit {
  id: number;
  type: string;
  amount_monthly: number;
}

function formatCurrencyDisplay(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function LocalInput({
  value,
  onBlurSave,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "onBlur" | "onChange" | "value"> & {
  value: string;
  onBlurSave: (val: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);

  return (
    <Input
      {...props}
      value={local}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={(e) => {
        focusedRef.current = false;
        onBlurSave(e.target.value);
      }}
    />
  );
}

function CurrencyInput({
  id,
  value,
  onChange,
  onBlur,
  disabled,
  placeholder,
}: {
  id?: string;
  value: number;
  onChange: (val: number) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [display, setDisplay] = useState(
    value ? formatCurrencyDisplay(value) : ""
  );
  const focusedRef = useRef(false);
  const localValueRef = useRef(value);

  useEffect(() => {
    if (!focusedRef.current) {
      setDisplay(value ? formatCurrencyDisplay(value) : "");
    }
    localValueRef.current = value;
  }, [value]);

  return (
    <div className="relative">
      <span className="text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 text-sm">
        $
      </span>
      <Input
        id={id}
        className="pl-7"
        value={display}
        placeholder={placeholder ?? "0"}
        disabled={disabled}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          const num = Number(raw) || 0;
          setDisplay(raw ? formatCurrencyDisplay(num) : "");
          localValueRef.current = num;
        }}
        onBlur={() => {
          focusedRef.current = false;
          const num = localValueRef.current;
          setDisplay(num ? formatCurrencyDisplay(num) : "");
          onChange(num);
          onBlur?.();
        }}
      />
    </div>
  );
}

function isDeadlinePassed(deadline: string | null): boolean {
  if (!deadline) return false;
  return new Date() > new Date(deadline + "T23:59:59");
}

export default function ScholarshipPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);

  const [schoolYear, setSchoolYear] = useState<SchoolYear | null>(null);
  const [scholarship, setScholarship] = useState<Scholarship | null>(null);
  const [familyId, setFamilyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scholarshipChoice, setScholarshipChoice] = useState<"none" | "snap" | "full" | null>(null);
  const [notParticipatingConfirm, setNotParticipatingConfirm] = useState(false);
  const [snapModalOpen, setSnapModalOpen] = useState(false);
  const [resetChoiceConfirm, setResetChoiceConfirm] = useState(false);

  const [members, setMembers] = useState<ContributingMember[]>([]);
  const [homes, setHomes] = useState<Home[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [benefits, setBenefits] = useState<Benefit[]>([]);

  const [householdAdults, setHouseholdAdults] = useState(0);
  const [householdChildren, setHouseholdChildren] = useState(0);
  const [noContributing, setNoContributing] = useState(false);

  const [businessIncome, setBusinessIncome] = useState(0);
  const [capitalGains, setCapitalGains] = useState(0);
  const [childSupport, setChildSupport] = useState(0);
  const [alimony, setAlimony] = useState(0);
  const [trustsIncome, setTrustsIncome] = useState(0);
  const [otherIncome, setOtherIncome] = useState(0);
  const [describeOtherIncome, setDescribeOtherIncome] = useState("");

  const [assetsChecking, setAssetsChecking] = useState(0);
  const [assetsSavings, setAssetsSavings] = useState(0);
  const [assetsRetirement, setAssetsRetirement] = useState(0);
  const [assetsStocks, setAssetsStocks] = useState(0);
  const [assetsTrusts, setAssetsTrusts] = useState(0);
  const [assetsBusiness, setAssetsBusiness] = useState(0);

  const [debtsCreditCards, setDebtsCreditCards] = useState(0);
  const [debtsStudentLoans, setDebtsStudentLoans] = useState(0);
  const [debtsPersonalLoans, setDebtsPersonalLoans] = useState(0);

  const [govBenefits, setGovBenefits] = useState(false);
  const [familyContribution, setFamilyContribution] = useState(0);
  const [advocacyLetter, setAdvocacyLetter] = useState("");
  const [signatureMeta, setSignatureMeta] = useState<Record<string, unknown> | null>(null);
  const [signatureLocalUrl, setSignatureLocalUrl] = useState<string | null>(null);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [snapBenefitsFile, setSnapBenefitsFile] = useState<Record<string, unknown> | null>(null);
  const [terminationLetter, setTerminationLetter] = useState<Record<string, unknown> | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const savedSnapshotRef = useRef<string>("");
  const initialSnapshotRef = useRef<string>("");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const handleSaveRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const [pendingDelete, setPendingDelete] = useState<{
    type: "member" | "benefit" | "home" | "vehicle";
    id: number;
    label: string;
  } | null>(null);

  const sigCanvasRef = useRef<SignatureCanvas>(null);
  const sigRestoredRef = useRef(false);

  function buildSnapshot() {
    return JSON.stringify({
      householdAdults, householdChildren, noContributing,
      businessIncome, capitalGains, childSupport, alimony, trustsIncome,
      otherIncome, describeOtherIncome, assetsChecking, assetsSavings,
      assetsRetirement, assetsStocks, assetsTrusts, assetsBusiness,
      debtsCreditCards, debtsStudentLoans, debtsPersonalLoans,
      govBenefits, familyContribution, advocacyLetter,
      signatureMeta, terminationLetter,
      members, homes, vehicles, benefits,
    });
  }

  const isDirty = savedSnapshotRef.current !== "" && buildSnapshot() !== savedSnapshotRef.current;

  function captureSnapshot() {
    savedSnapshotRef.current = buildSnapshot();
  }

  const loadData = useCallback(async () => {
    try {
      const familyRes = await fetch("/api/families");
      if (!familyRes.ok) return;
      const familyData = await familyRes.json();
      if (!familyData?.id) return;
      setFamilyId(familyData.id);

      const [yearRes, scholarshipRes] = await Promise.all([
        fetch("/api/school-years"),
        fetch(`/api/scholarship?familyId=${familyData.id}&yearId=${yearId}`),
      ]);

      if (yearRes.ok) {
        const years: SchoolYear[] = await yearRes.json();
        setSchoolYear(years.find((y) => y.id === yearId) ?? null);
      }

      if (scholarshipRes.ok) {
        const data: Scholarship | null = await scholarshipRes.json();
        if (data) {
          const fullRes = await fetch(`/api/scholarship/${data.id}`);
          if (fullRes.ok) {
            const resp: FullScholarshipResponse = await fullRes.json();
            const s = resp.opportunity_scholarship;
            setScholarship(s);
            populateForm(s);
            if (s.isNotParticipating) {
              setScholarshipChoice("none");
            } else if (s.isSNAPBenefits) {
              setScholarshipChoice("snap");
            } else if (s.isOpportunityScholarship) {
              setScholarshipChoice("full");
            }
            const loadedMembers = resp.contributing_members ?? [];
            const loadedHomes = resp.homes ?? [];
            const loadedVehicles = resp.vehicles ?? [];
            const loadedBenefits = resp.benefits ?? [];
            setMembers(loadedMembers);
            setHomes(loadedHomes);
            setVehicles(loadedVehicles);
            setBenefits(loadedBenefits);
            initialSnapshotRef.current = JSON.stringify({
              householdAdults: s.household_adults ?? 0,
              householdChildren: s.household_children ?? 0,
              noContributing: s.no_contributing_member ?? false,
              businessIncome: s.business_income_monthly ?? 0,
              capitalGains: s.capital_gains_monthly ?? 0,
              childSupport: s.child_support_monthly ?? 0,
              alimony: s.alimony_monthly ?? 0,
              trustsIncome: s.trusts_monthly ?? 0,
              otherIncome: s.other_income_monthly ?? 0,
              describeOtherIncome: s.describe_other_income ?? "",
              assetsChecking: s.assets_checking ?? 0,
              assetsSavings: s.assets_savings ?? 0,
              assetsRetirement: s.assets_retirement_savings ?? 0,
              assetsStocks: s.assets_stocks_bonds_securities ?? 0,
              assetsTrusts: s.assets_trusts_inheritance ?? 0,
              assetsBusiness: s.assets_business ?? 0,
              debtsCreditCards: s.debts_credit_cards ?? 0,
              debtsStudentLoans: s.debts_student_loans ?? 0,
              debtsPersonalLoans: s.debts_personal_loans ?? 0,
              govBenefits: s.government_benefits ?? false,
              familyContribution: s.family_contribution_per_month ?? 0,
              advocacyLetter: s.scholarship_advocacy_letter ?? "",
              signatureMeta: (() => {
                if (!s.signature) return null;
                let sig: Record<string, unknown>;
                if (typeof s.signature === "string") {
                  try { sig = JSON.parse(s.signature); } catch { sig = {}; }
                } else {
                  sig = s.signature as Record<string, unknown>;
                }
                return Object.keys(sig).length > 0 ? sig : null;
              })(),
              terminationLetter: s.termination_letter ?? null,
              members: loadedMembers,
              homes: loadedHomes,
              vehicles: loadedVehicles,
              benefits: loadedBenefits,
            });
          }
        }
      }
    } catch (err) {
      console.error("Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, [yearId]);

  function populateForm(s: Scholarship) {
    setHouseholdAdults(s.household_adults ?? 0);
    setHouseholdChildren(s.household_children ?? 0);
    setNoContributing(s.no_contributing_member ?? false);
    setBusinessIncome(s.business_income_monthly ?? 0);
    setCapitalGains(s.capital_gains_monthly ?? 0);
    setChildSupport(s.child_support_monthly ?? 0);
    setAlimony(s.alimony_monthly ?? 0);
    setTrustsIncome(s.trusts_monthly ?? 0);
    setOtherIncome(s.other_income_monthly ?? 0);
    setDescribeOtherIncome(s.describe_other_income ?? "");
    setAssetsChecking(s.assets_checking ?? 0);
    setAssetsSavings(s.assets_savings ?? 0);
    setAssetsRetirement(s.assets_retirement_savings ?? 0);
    setAssetsStocks(s.assets_stocks_bonds_securities ?? 0);
    setAssetsTrusts(s.assets_trusts_inheritance ?? 0);
    setAssetsBusiness(s.assets_business ?? 0);
    setDebtsCreditCards(s.debts_credit_cards ?? 0);
    setDebtsStudentLoans(s.debts_student_loans ?? 0);
    setDebtsPersonalLoans(s.debts_personal_loans ?? 0);
    setGovBenefits(s.government_benefits ?? false);
    setFamilyContribution(s.family_contribution_per_month ?? 0);
    setAdvocacyLetter(s.scholarship_advocacy_letter ?? "");
    if (s.last_edited) setLastSaved(new Date(s.last_edited));
    if (s.signature) {
      let sig: Record<string, unknown>;
      if (typeof s.signature === "string") {
        try { sig = JSON.parse(s.signature); } catch { sig = {}; }
      } else {
        sig = s.signature as Record<string, unknown>;
      }
      if (Object.keys(sig).length > 0) {
        setSignatureMeta(sig);
        if (typeof sig.url === "string") {
          setSignatureLocalUrl(sig.url);
        } else if (typeof sig.path === "string") {
          const base = process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io";
          setSignatureLocalUrl(`${base}${sig.path}`);
        }
      }
    }
    if (s.snap_benefits) {
      setSnapBenefitsFile(s.snap_benefits as Record<string, unknown>);
    }
    if (s.termination_letter) {
      setTerminationLetter(s.termination_letter as Record<string, unknown>);
    }
  }

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!loading && initialSnapshotRef.current && savedSnapshotRef.current === "") {
      savedSnapshotRef.current = initialSnapshotRef.current;
    }
  }, [loading]);

  useEffect(() => {
    if (!lastSaved) return;
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, [lastSaved]);

  const sigDataUrlRef = useRef<string | null>(null);

  async function restoreSignatureToCanvas() {
    if (!sigCanvasRef.current || sigRestoredRef.current) return;
    const url = sigDataUrlRef.current;
    if (!url) return;

    let dataUrl = url;
    if (!url.startsWith("data:")) {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {
        return;
      }
    }

    sigCanvasRef.current.fromDataURL(dataUrl);
    sigRestoredRef.current = true;
  }

  useEffect(() => {
    sigDataUrlRef.current = signatureLocalUrl;
  }, [signatureLocalUrl]);

  useEffect(() => {
    if (scholarshipChoice !== "full") return;
    const timer = setTimeout(() => restoreSignatureToCanvas(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scholarshipChoice]);

  async function ensureScholarship(): Promise<number | null> {
    if (scholarship) return scholarship.id;
    if (!familyId) return null;

    const res = await fetch("/api/scholarship", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registration_families_id: familyId,
        registration_school_years_id: yearId,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    setScholarship(data);
    return data.id;
  }

  async function handleSave() {
    setSaving(true);
    savingRef.current = true;
    try {
      const sid = await ensureScholarship();
      if (!sid) return;

      const scholarshipPatch = fetch(`/api/scholarship/${sid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          household_adults: householdAdults,
          household_children: householdChildren,
          no_contributing_member: noContributing,
          business_income_monthly: businessIncome,
          capital_gains_monthly: capitalGains,
          child_support_monthly: childSupport,
          alimony_monthly: alimony,
          trusts_monthly: trustsIncome,
          other_income_monthly: otherIncome,
          describe_other_income: describeOtherIncome,
          assets_checking: assetsChecking,
          assets_savings: assetsSavings,
          assets_retirement_savings: assetsRetirement,
          assets_stocks_bonds_securities: assetsStocks,
          assets_trusts_inheritance: assetsTrusts,
          assets_business: assetsBusiness,
          debts_credit_cards: debtsCreditCards,
          debts_student_loans: debtsStudentLoans,
          debts_personal_loans: debtsPersonalLoans,
          government_benefits: govBenefits,
          family_contribution_per_month: familyContribution,
          scholarship_advocacy_letter: advocacyLetter,
          snap_benefits: snapBenefitsFile,
          signature: signatureMeta,
          termination_letter: terminationLetter,
          last_edited: Date.now(),
        }),
      });

      const memberPatches = members.map((m) =>
        fetch(`/api/scholarship-items/contributing-members/${m.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: m.first_name,
            last_name: m.last_name,
            address: m.address,
            address_1: m.address_1,
            address_2: m.address_2,
            city: m.city,
            state: m.state,
            zipcode: m.zipcode,
            estimated_annual_income: m.estimated_annual_income,
            isW2: m.isW2,
            isPayStubs: m.isPayStubs,
            w2: m.w2,
            paystub_1: m.paystub_1,
            paystub_2: m.paystub_2,
            paystub_3: m.paystub_3,
            paystub_4: m.paystub_4,
          }),
        })
      );

      const homePatches = homes.map((h) =>
        fetch(`/api/scholarship-items/homes/${h.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: h.type,
            address: h.address,
            address_1: h.address_1,
            address_2: h.address_2,
            city: h.city,
            state: h.state,
            zipcode: h.zipcode,
            total_value: h.total_value,
            outstanding_debt: h.outstanding_debt,
          }),
        })
      );

      const vehiclePatches = vehicles.map((v) =>
        fetch(`/api/scholarship-items/vehicles/${v.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: v.type,
            car_make: v.car_make,
            car_model: v.car_model,
            car_year: v.car_year,
            total_value: v.total_value,
            remaining_debt: v.remaining_debt,
          }),
        })
      );

      const benefitPatches = benefits.map((b) =>
        fetch(`/api/scholarship-items/benefits/${b.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: b.type,
            amount_monthly: b.amount_monthly,
          }),
        })
      );

      const [scholarshipRes] = await Promise.all([
        scholarshipPatch,
        ...memberPatches,
        ...homePatches,
        ...vehiclePatches,
        ...benefitPatches,
      ]);

      if (scholarshipRes.ok) {
        const saved: Scholarship = await scholarshipRes.json();
        setScholarship(saved);
        setLastSaved(saved.last_edited ? new Date(saved.last_edited) : new Date());
      } else {
        setLastSaved(new Date());
      }
      captureSnapshot();
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  handleSaveRef.current = handleSave;

  const currentSnapshot = buildSnapshot();

  useEffect(() => {
    if (savedSnapshotRef.current === "" || savingRef.current) return;
    if (currentSnapshot === savedSnapshotRef.current) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      if (!savingRef.current) handleSaveRef.current?.();
    }, 4000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSnapshot]);

  function patchMemberLocal(id: number, data: Partial<ContributingMember>) {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...data } : m))
    );
  }
  function patchHomeLocal(id: number, data: Partial<Home>) {
    setHomes((prev) => prev.map((h) => (h.id === id ? { ...h, ...data } : h)));
  }
  function patchVehicleLocal(id: number, data: Partial<Vehicle>) {
    setVehicles((prev) =>
      prev.map((v) => (v.id === id ? { ...v, ...data } : v))
    );
  }
  function patchBenefitLocal(id: number, data: Partial<Benefit>) {
    setBenefits((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...data } : b))
    );
  }



  async function addMember() {
    const sid = await ensureScholarship();
    if (!sid) return;
    const res = await fetch(`/api/scholarship/${sid}/contributing-members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) setMembers([...members, await res.json()]);
  }

  async function deleteMember(id: number) {
    await fetch(`/api/scholarship-items/contributing-members/${id}`, {
      method: "DELETE",
    });
    setMembers(members.filter((m) => m.id !== id));
  }

  async function addHome() {
    const sid = await ensureScholarship();
    if (!sid) return;
    const res = await fetch(`/api/scholarship/${sid}/homes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) setHomes([...homes, await res.json()]);
  }

  async function deleteHome(id: number) {
    await fetch(`/api/scholarship-items/homes/${id}`, { method: "DELETE" });
    setHomes(homes.filter((h) => h.id !== id));
  }

  async function addVehicle() {
    const sid = await ensureScholarship();
    if (!sid) return;
    const res = await fetch(`/api/scholarship/${sid}/vehicles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) setVehicles([...vehicles, await res.json()]);
  }

  async function deleteVehicle(id: number) {
    await fetch(`/api/scholarship-items/vehicles/${id}`, { method: "DELETE" });
    setVehicles(vehicles.filter((v) => v.id !== id));
  }

  async function addBenefit() {
    const sid = await ensureScholarship();
    if (!sid) return;
    const res = await fetch(`/api/scholarship/${sid}/benefits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) setBenefits([...benefits, await res.json()]);
  }

  async function deleteBenefit(id: number) {
    await fetch(`/api/scholarship-items/benefits/${id}`, { method: "DELETE" });
    setBenefits(benefits.filter((b) => b.id !== id));
  }

  const deadlinePassed = isDeadlinePassed(
    schoolYear?.scholarship_deadline ?? null
  );
  const isReadonly = deadlinePassed;

  function confirmDelete() {
    if (!pendingDelete) return;
    switch (pendingDelete.type) {
      case "member": deleteMember(pendingDelete.id); break;
      case "benefit": deleteBenefit(pendingDelete.id); break;
      case "home": deleteHome(pendingDelete.id); break;
      case "vehicle": deleteVehicle(pendingDelete.id); break;
    }
    setPendingDelete(null);
  }

  async function handleSignatureEnd() {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return;
    const dataUrl = sigCanvasRef.current.toDataURL("image/png");
    setSignatureLocalUrl(dataUrl);
    setSignatureUploading(true);
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], "signature.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        const meta = await res.json();
        setSignatureMeta(meta);
      }
    } catch (err) {
      console.error("Signature upload failed:", err);
    } finally {
      setSignatureUploading(false);
    }
  }

  function clearSignature() {
    sigCanvasRef.current?.clear();
    setSignatureMeta(null);
    setSignatureLocalUrl(null);
    sigRestoredRef.current = false;
  }

  if (loading) {
    return (
      <>
        <StepHeader yearId={String(yearId)} yearName="" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </>
    );
  }

  const isChoiceLocked = scholarshipChoice === "none" || scholarshipChoice === "snap" || scholarshipChoice === "full";

  async function saveScholarshipChoice(choice: "none" | "snap" | "full") {
    const sid = await ensureScholarship();
    if (!sid) return;
    await fetch(`/api/scholarship/${sid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isNotParticipating: choice === "none",
        isSNAPBenefits: choice === "snap",
        isOpportunityScholarship: choice === "full",
        last_edited: Date.now(),
      }),
    });
  }

  async function resetScholarshipChoice() {
    setScholarshipChoice(null);
    if (scholarship?.id) {
      await fetch(`/api/scholarship/${scholarship.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isNotParticipating: false,
          isSNAPBenefits: false,
          isOpportunityScholarship: false,
          last_edited: Date.now(),
        }),
      });
    }
  }

  if (scholarshipChoice !== "full") {
    return (
      <>
        <StepHeader
          yearId={String(yearId)}
          yearName={schoolYear?.year_name ?? ""}
        />
        <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
          <div>
            <h1 className="text-2xl font-semibold">
              Welcome to the SailFuture Opportunity Scholarship Application
            </h1>
            <p className="text-muted-foreground text-sm mt-3 max-w-3xl">
              The SailFuture Academy Scholarship is designed to support students who exhibit financial need, academic promise, and a strong commitment to their education. This scholarship is awarded on a sliding scale, with the amount determined by the applicant&apos;s household income and assets.
            </p>
            <p className="text-muted-foreground text-sm mt-3 max-w-3xl">
              The SailFuture Scholarship Fund is made possible through generous contributions from supporters, including national grants, individual donors, corporations, and organizations dedicated to expanding educational opportunities for students in need.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-1 max-w-2xl">
            <Card
              className={`gap-0 py-0 transition-colors ${
                scholarshipChoice === "none"
                  ? "border-primary ring-2 ring-primary/20"
                  : scholarshipChoice && scholarshipChoice !== "none"
                    ? "opacity-50 pointer-events-none"
                    : "cursor-pointer hover:border-primary"
              }`}
              onClick={() => {
                if (isChoiceLocked) return;
                setNotParticipatingConfirm(true);
              }}
            >
              <CardContent className="py-4 flex items-center gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                  <svg className="size-5 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Choose not to participate</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    I do not wish to apply for the SailFuture Opportunity Scholarship.
                  </p>
                </div>
                {scholarshipChoice === "none" && (
                  <svg className="size-5 shrink-0 text-primary" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                )}
              </CardContent>
            </Card>

            <Card
              className={`gap-0 py-0 transition-colors ${
                scholarshipChoice === "snap"
                  ? "border-primary ring-2 ring-primary/20"
                  : scholarshipChoice && scholarshipChoice !== "snap"
                    ? "opacity-50 pointer-events-none"
                    : "cursor-pointer hover:border-primary"
              }`}
              onClick={() => {
                if (isChoiceLocked) return;
                setSnapModalOpen(true);
              }}
            >
              <CardContent className="py-4 flex items-center gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                  <svg className="size-5 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">I receive SNAP benefits</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    If you receive SNAP benefits, you pre-qualify for the SailFuture Academy Scholarship.
                  </p>
                </div>
                {scholarshipChoice === "snap" && (
                  <svg className="size-5 shrink-0 text-primary" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                )}
              </CardContent>
            </Card>

            <Card
              className={`gap-0 py-0 transition-colors ${
                scholarshipChoice === "full"
                  ? "border-primary ring-2 ring-primary/20"
                  : scholarshipChoice && scholarshipChoice !== "full"
                    ? "opacity-50 pointer-events-none"
                    : "cursor-pointer hover:border-primary"
              }`}
              onClick={async () => {
                if (isChoiceLocked) return;
                setScholarshipChoice("full");
                await saveScholarshipChoice("full");
              }}
            >
              <CardContent className="py-4 flex items-center gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                  <svg className="size-5 text-blue-600 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                    <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {scholarship ? "Continue the SailFuture Opportunity Scholarship" : "Complete the SailFuture Opportunity Scholarship"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {scholarship
                      ? "Resume where you left off on your scholarship application."
                      : "Fill out the full scholarship application with household and financial information."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {isChoiceLocked && (
            <div className="max-w-2xl">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setResetChoiceConfirm(true)}
              >
                Change Selection
              </Button>
            </div>
          )}

          {scholarshipChoice === "none" && (
            <div className="max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                You have chosen not to participate in the scholarship program.
              </p>
            </div>
          )}

          {scholarshipChoice === "snap" && (
            <Card className="max-w-2xl gap-0 py-0">
              <CardContent className="py-5 space-y-4">
                <div>
                  <p className="text-sm font-medium">SNAP Benefits Award Letter</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload your valid SNAP benefits award letter below.
                  </p>
                </div>
                <IncomeFileUpload
                  label="Drop SNAP award letter here or click to upload"
                  existingFile={snapBenefitsFile as XanoFileMetadata | null}
                  onUploaded={async (meta) => {
                    setSnapBenefitsFile(meta);
                    const sid = scholarship?.id ?? await ensureScholarship();
                    if (sid) {
                      await fetch(`/api/scholarship/${sid}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ snap_benefits: meta, last_edited: Date.now() }),
                      });
                    }
                  }}
                  onRemoved={async () => {
                    setSnapBenefitsFile(null);
                    const sid = scholarship?.id ?? await ensureScholarship();
                    if (sid) {
                      await fetch(`/api/scholarship/${sid}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ snap_benefits: {}, last_edited: Date.now() }),
                      });
                    }
                  }}
                />
              </CardContent>
            </Card>
          )}

          <div className="h-20" />
        </div>

        {/* Not Participating Warning Modal */}
        <AlertDialog open={notParticipatingConfirm} onOpenChange={setNotParticipatingConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Choose Not to Participate?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you do not wish to apply for the SailFuture Opportunity Scholarship? This selection can be changed later by contacting the school.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  setScholarshipChoice("none");
                  setNotParticipatingConfirm(false);
                  await saveScholarshipChoice("none");
                }}
              >
                Yes, I Do Not Wish to Participate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* SNAP Benefits Modal */}
        <AlertDialog open={snapModalOpen} onOpenChange={setSnapModalOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>SNAP Benefits Pre-Qualification</AlertDialogTitle>
              <AlertDialogDescription>
                If you receive SNAP benefits, you pre-qualify for the SailFuture Academy Scholarship. If applicable, please upload your SNAP benefits award letter below.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  setScholarshipChoice("snap");
                  setSnapModalOpen(false);
                  await saveScholarshipChoice("snap");
                }}
              >
                I Receive SNAP Benefits
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reset Selection Warning Modal */}
        <AlertDialog open={resetChoiceConfirm} onOpenChange={setResetChoiceConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change Scholarship Selection?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to change your scholarship selection? Your current choice will be cleared and you will need to select a new option. Any previously uploaded documents will remain saved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Current Selection</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  setResetChoiceConfirm(false);
                  await resetScholarshipChoice();
                }}
              >
                Yes, Change Selection
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <StepHeader
        yearId={String(yearId)}
        yearName={schoolYear?.year_name ?? ""}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Scholarships</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Complete the opportunity scholarship application for{" "}
              {schoolYear?.year_name ?? "this year"}.
            </p>
          </div>
        </div>

        {deadlinePassed && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-900/20">
            <p className="text-sm text-red-700 dark:text-red-300">
              The scholarship deadline has passed. This form is view-only.
            </p>
          </div>
        )}

        {/* Annual Household Income Documentation */}
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="border-b py-3 !pb-3">
            <CardTitle className="text-lg">Annual Household Income Documentation</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              To process your application, we need to collect some information about the family of the applicant(s).
            </p>
          </CardHeader>
          <CardContent className="space-y-6 py-5 bg-gray-50 dark:bg-muted/50">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Household Size
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel className="text-xs">
                    Adults in Household
                  </FieldLabel>
                  <Input
                    type="number"
                    min={0}
                    value={householdAdults || ""}
                    onChange={(e) =>
                      setHouseholdAdults(Number(e.target.value) || 0)
                    }
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Children in Household
                  </FieldLabel>
                  <Input
                    type="number"
                    min={0}
                    value={householdChildren || ""}
                    onChange={(e) =>
                      setHouseholdChildren(Number(e.target.value) || 0)
                    }
                    disabled={isReadonly}
                  />
                </Field>
              </div>
              <label htmlFor="no_contributing" className="mt-4 inline-flex w-auto cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  id="no_contributing"
                  checked={noContributing}
                  onChange={(e) => setNoContributing(e.target.checked)}
                  disabled={isReadonly}
                  className="size-5 cursor-pointer rounded accent-primary"
                />
                <span className="text-sm select-none">No contributing members in the household</span>
              </label>
              <AnimatePresence initial={false}>
              {noContributing && (
                <motion.div
                  key="no-contributing-section"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="mt-4">
                    <p className="text-sm text-muted-foreground mb-3">
                      You have selected that you have no persons who are currently employed or have a contributing income to the household. If this is accurate, please upload proof of unemployment or termination.
                    </p>
                    <p className="text-xs font-medium mb-2">Termination / Unemployment Letter</p>
                    <IncomeFileUpload
                      label="Drop termination letter here or click to upload"
                      disabled={isReadonly}
                      existingFile={terminationLetter as XanoFileMetadata | null}
                      onUploaded={(meta) => setTerminationLetter(meta)}
                      onRemoved={() => setTerminationLetter({})}
                    />
                  </div>
                </motion.div>
              )}
              </AnimatePresence>
            </section>

            {/* Monthly Income */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Monthly Income
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field>
                  <FieldLabel className="text-xs">Business Income</FieldLabel>
                  <CurrencyInput
                    value={businessIncome}
                    onChange={setBusinessIncome}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Capital Gains</FieldLabel>
                  <CurrencyInput
                    value={capitalGains}
                    onChange={setCapitalGains}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Child Support</FieldLabel>
                  <CurrencyInput
                    value={childSupport}
                    onChange={setChildSupport}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Alimony</FieldLabel>
                  <CurrencyInput
                    value={alimony}
                    onChange={setAlimony}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Trusts</FieldLabel>
                  <CurrencyInput
                    value={trustsIncome}
                    onChange={setTrustsIncome}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Other Income</FieldLabel>
                  <CurrencyInput
                    value={otherIncome}
                    onChange={setOtherIncome}
                    disabled={isReadonly}
                  />
                </Field>
              </div>
              {otherIncome > 0 && (
                <div className="mt-4">
                  <Field>
                    <FieldLabel className="text-xs">
                      Describe Other Income
                    </FieldLabel>
                    <Input
                      value={describeOtherIncome}
                      onChange={(e) => setDescribeOtherIncome(e.target.value)}
                      disabled={isReadonly}
                      placeholder="Describe the source of other income"
                    />
                  </Field>
                </div>
              )}
            </section>

            <Separator />

            {/* Government Benefits */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Government Benefits
              </h3>
              <label htmlFor="gov_benefits" className="inline-flex w-auto cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  id="gov_benefits"
                  checked={govBenefits}
                  onChange={(e) => setGovBenefits(e.target.checked)}
                  disabled={isReadonly}
                  className="size-5 cursor-pointer rounded accent-primary"
                />
                <span className="text-sm select-none">My household receives government benefits</span>
              </label>
              <AnimatePresence initial={false}>
              {govBenefits && (
                <motion.div
                  key="gov-benefits-section"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-3 border-b pb-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Benefit Types
                    </h4>
                    {!isReadonly && (
                      <Button size="sm" onClick={addBenefit}>
                        Add Benefit
                      </Button>
                    )}
                  </div>
                  {benefits.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No benefits listed.
                    </p>
                  ) : (
                    <motion.div layout className="space-y-3">
                      <AnimatePresence initial={false}>
                      {benefits.map((benefit) => (
                        <motion.div
                          key={benefit.id}
                          layout
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
                          transition={{ duration: 0.18 }}
                          className="flex items-end gap-3"
                        >
                          <Field className="flex-1">
                            <FieldLabel className="text-xs">Type</FieldLabel>
                            <Select
                              value={benefit.type}
                              onValueChange={(val) => {
                                patchBenefitLocal(benefit.id, { type: val });
                              }}
                              disabled={isReadonly}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="SNAP">SNAP</SelectItem>
                                <SelectItem value="Medicaid">Medicaid</SelectItem>
                                <SelectItem value="TANF">TANF</SelectItem>
                                <SelectItem value="WIC">WIC</SelectItem>
                                <SelectItem value="SSI">SSI</SelectItem>
                                <SelectItem value="SSDI">SSDI</SelectItem>
                                <SelectItem value="Housing Assistance">
                                  Housing Assistance
                                </SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field className="w-40">
                            <FieldLabel className="text-xs">
                              Monthly Amount
                            </FieldLabel>
                            <CurrencyInput
                              value={benefit.amount_monthly}
                              onChange={(val) => patchBenefitLocal(benefit.id, { amount_monthly: val })}
                              disabled={isReadonly}
                            />
                          </Field>
                          {!isReadonly && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-red-600"
                            onClick={() => setPendingDelete({ type: "benefit", id: benefit.id, label: "this benefit" })}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                        </motion.div>
                      ))}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </div>
                </motion.div>
              )}
              </AnimatePresence>
            </section>
          </CardContent>
        </Card>

        {/* Contributing Members */}
        <AnimatePresence initial={false}>
        {!noContributing && (
          <motion.div
            key="contributing-members-card"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="border-b py-3 !pb-3">
              <CardTitle className="text-lg">Contributing Members</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Identify each person in your household who provides or is responsible for any portion of the family&apos;s income.
              </p>
            </CardHeader>
            <CardContent className="space-y-6 py-5 bg-gray-50 dark:bg-muted/50">
              {members.length === 0 ? (
                <Empty className="border rounded-lg py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Users />
                    </EmptyMedia>
                    <EmptyTitle>No Contributing Members</EmptyTitle>
                    <EmptyDescription>Add members of your household who contribute income.</EmptyDescription>
                  </EmptyHeader>
                  {!isReadonly && (
                    <EmptyContent>
                      <Button size="sm" onClick={addMember}>Add Member</Button>
                    </EmptyContent>
                  )}
                </Empty>
              ) : (
                <motion.div layout className="space-y-4">
                  <AnimatePresence initial={false}>
                  {members.map((member, idx) => (
                    <motion.div
                      key={member.id}
                      layout
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      className="rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10"
                    >
                      <div className="-mx-4 mb-3 flex items-center justify-between border-b border-foreground/10 px-4 pb-3">
                        <p className="text-sm font-semibold">
                          Contributing Member {idx + 1}
                        </p>
                        {!isReadonly && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant={idx === members.length - 1 ? "default" : "outline"}
                              size="sm"
                              onClick={addMember}
                              disabled={idx !== members.length - 1}
                            >
                              Add Another Member
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-red-600"
                              onClick={() => setPendingDelete({ type: "member", id: member.id, label: `Contributing Member ${idx + 1}` })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel className="text-xs">First Name</FieldLabel>
                          <LocalInput
                            value={member.first_name ?? ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { first_name: val })}
                            disabled={isReadonly}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Last Name</FieldLabel>
                          <LocalInput
                            value={member.last_name ?? ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { last_name: val })}
                            disabled={isReadonly}
                          />
                        </Field>
                      </div>

                      <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr]">
                        <Field>
                          <FieldLabel className="text-xs">Street Address</FieldLabel>
                          <LocalInput
                            value={member.address_1 || ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { address_1: val })}
                            disabled={isReadonly}
                            placeholder="123 Main Street"
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Apt, Suite, etc.</FieldLabel>
                          <LocalInput
                            value={member.address_2 || ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { address_2: val })}
                            disabled={isReadonly}
                            placeholder="Apt 4B"
                          />
                        </Field>
                      </div>
                      <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
                        <Field>
                          <FieldLabel className="text-xs">City</FieldLabel>
                          <LocalInput
                            value={member.city || ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { city: val })}
                            disabled={isReadonly}
                            placeholder="St. Petersburg"
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">State</FieldLabel>
                          <Combobox
                            value={member.state || ""}
                            onValueChange={(v) => patchMemberLocal(member.id, { state: v as string })}
                          >
                            <ComboboxInput placeholder="Search state..." className="w-full" disabled={isReadonly} />
                            <ComboboxContent>
                              <ComboboxList>
                                {US_STATES.map((s) => (
                                  <ComboboxItem key={s.value} value={s.value}>
                                    {s.label}
                                  </ComboboxItem>
                                ))}
                              </ComboboxList>
                              <ComboboxEmpty>No state found</ComboboxEmpty>
                            </ComboboxContent>
                          </Combobox>
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Zip Code</FieldLabel>
                          <LocalInput
                            value={member.zipcode || ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { zipcode: val })}
                            disabled={isReadonly}
                            placeholder="33701"
                          />
                        </Field>
                      </div>

                      <Separator className="my-4" />

                      <div className="space-y-4">
                        <Field className="max-w-xs">
                          <FieldLabel className="text-xs">Estimated Annual Income</FieldLabel>
                          <CurrencyInput
                            value={member.estimated_annual_income || 0}
                            onChange={(val) => patchMemberLocal(member.id, { estimated_annual_income: val })}
                            disabled={isReadonly}
                          />
                        </Field>

                        <div>
                          <FieldLabel className="text-xs mb-2">Income Verification</FieldLabel>
                          <div className="flex items-center gap-5">
                            <label htmlFor={`w2-${member.id}`} className="inline-flex w-auto cursor-pointer items-center gap-2.5">
                              <input
                                type="checkbox"
                                id={`w2-${member.id}`}
                                checked={!!member.isW2}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    patchMemberLocal(member.id, { isW2: true, isPayStubs: false });
                                  } else {
                                    patchMemberLocal(member.id, { isW2: false });
                                  }
                                }}
                                disabled={isReadonly}
                                className="size-5 cursor-pointer rounded accent-primary"
                              />
                              <span className="text-sm select-none">W-2 Form</span>
                            </label>
                            <label htmlFor={`paystubs-${member.id}`} className="inline-flex w-auto cursor-pointer items-center gap-2.5">
                              <input
                                type="checkbox"
                                id={`paystubs-${member.id}`}
                                checked={!!member.isPayStubs}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    patchMemberLocal(member.id, { isPayStubs: true, isW2: false });
                                  } else {
                                    patchMemberLocal(member.id, { isPayStubs: false });
                                  }
                                }}
                                disabled={isReadonly}
                                className="size-5 cursor-pointer rounded accent-primary"
                              />
                              <span className="text-sm select-none">Last 4 Pay Stubs</span>
                            </label>
                          </div>
                          <AnimatePresence initial={false} mode="wait">
                          {member.isW2 && (
                            <motion.div
                              key={`w2-upload-${member.id}`}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2, ease: "easeInOut" }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3">
                                <p className="text-xs font-medium mb-2">Upload W-2 Form</p>
                                <IncomeFileUpload
                                  label="Drop W-2 here or click to upload"
                                  disabled={isReadonly}
                                  existingFile={member.w2 as XanoFileMetadata | null}
                                  onUploaded={(meta) => patchMemberLocal(member.id, { w2: meta })}
                                  onRemoved={() => patchMemberLocal(member.id, { w2: {} })}
                                />
                              </div>
                            </motion.div>
                          )}
                          {member.isPayStubs && (
                            <motion.div
                              key={`paystubs-upload-${member.id}`}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2, ease: "easeInOut" }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 space-y-3">
                                {([1, 2, 3, 4] as const).map((num) => {
                                  const field = `paystub_${num}` as keyof ContributingMember;
                                  return (
                                    <div key={num}>
                                      <p className="text-xs font-medium mb-2">Pay Stub {num}</p>
                                      <IncomeFileUpload
                                        label={`Drop pay stub ${num} here or click to upload`}
                                        disabled={isReadonly}
                                        existingFile={member[field] as XanoFileMetadata | null}
                                        onUploaded={(meta) => patchMemberLocal(member.id, { [field]: meta as Record<string, unknown> })}
                                        onRemoved={() => patchMemberLocal(member.id, { [field]: {} as Record<string, unknown> })}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </motion.div>
                          )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                </motion.div>
              )}
            </CardContent>
          </Card>
          </motion.div>
        )}
        </AnimatePresence>

        {/* Family Household Assets */}
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="border-b py-3 !pb-3">
            <CardTitle className="text-lg">Family Household Assets</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              In this section, briefly outline all financial resources available to your household. These may include cash in checking or savings accounts, investments (stocks, bonds, mutual funds), retirement accounts, real estate holdings, and any other items of substantial value. Indicate approximate market values and note whether the assets are liquid (easily converted to cash). This clarity helps the scholarship committee accurately gauge your overall financial picture.
            </p>
          </CardHeader>
          <CardContent className="space-y-6 py-5 bg-gray-50 dark:bg-muted/50">
            {/* Assets */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Financial Assets
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field>
                  <FieldLabel className="text-xs">
                    Checking Accounts
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsChecking}
                    onChange={setAssetsChecking}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Savings Accounts
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsSavings}
                    onChange={setAssetsSavings}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Retirement / Savings
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsRetirement}
                    onChange={setAssetsRetirement}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Stocks / Bonds / Securities
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsStocks}
                    onChange={setAssetsStocks}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Trusts / Inheritance
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsTrusts}
                    onChange={setAssetsTrusts}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Business</FieldLabel>
                  <CurrencyInput
                    value={assetsBusiness}
                    onChange={setAssetsBusiness}
                    disabled={isReadonly}
                  />
                </Field>
              </div>
            </section>

            <Separator />

            {/* Debts */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Debts
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel className="text-xs">Credit Cards</FieldLabel>
                  <CurrencyInput
                    value={debtsCreditCards}
                    onChange={setDebtsCreditCards}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Student Loans</FieldLabel>
                  <CurrencyInput
                    value={debtsStudentLoans}
                    onChange={setDebtsStudentLoans}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Personal Loans</FieldLabel>
                  <CurrencyInput
                    value={debtsPersonalLoans}
                    onChange={setDebtsPersonalLoans}
                    disabled={isReadonly}
                  />
                </Field>
              </div>
            </section>

            <Separator />

            {/* Homes / Real Estate */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Home / Real Estate
                </h3>
              </div>
              {homes.length === 0 ? (
                <Empty className="border rounded-lg py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Home />
                    </EmptyMedia>
                    <EmptyTitle>No Properties Listed</EmptyTitle>
                    <EmptyDescription>Add any real estate or properties owned by your household.</EmptyDescription>
                  </EmptyHeader>
                  {!isReadonly && (
                    <EmptyContent>
                      <Button size="sm" onClick={addHome}>Add Property</Button>
                    </EmptyContent>
                  )}
                </Empty>
              ) : (
                <motion.div layout className="space-y-4">
                  <AnimatePresence initial={false}>
                  {homes.map((home, idx) => (
                    <motion.div
                      key={home.id}
                      layout
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      className="rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10"
                    >
                      <div className="-mx-4 mb-3 flex items-center justify-between border-b border-foreground/10 px-4 pb-3">
                        <p className="text-sm font-semibold">
                          Property {idx + 1}
                        </p>
                        {!isReadonly && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant={idx === homes.length - 1 ? "default" : "outline"}
                              size="sm"
                              onClick={addHome}
                              disabled={idx !== homes.length - 1}
                            >
                              Add Another Property
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-red-600"
                              onClick={() => setPendingDelete({ type: "home", id: home.id, label: `Property ${idx + 1}` })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel className="text-xs">Type</FieldLabel>
                          <Select
                            value={home.type ?? ""}
                            onValueChange={(val) => {
                              patchHomeLocal(home.id, { type: val });
                            }}
                            disabled={isReadonly}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Primary Residence">
                                Primary Residence
                              </SelectItem>
                              <SelectItem value="Rental Property">
                                Rental Property
                              </SelectItem>
                              <SelectItem value="Vacation Home">
                                Vacation Home
                              </SelectItem>
                              <SelectItem value="Land">Land</SelectItem>
                              <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr]">
                        <Field>
                          <FieldLabel className="text-xs">Street Address</FieldLabel>
                          <LocalInput
                            value={home.address_1 || ""}
                            onBlurSave={(val) => patchHomeLocal(home.id, { address_1: val })}
                            disabled={isReadonly}
                            placeholder="123 Main Street"
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Apt, Suite, etc.</FieldLabel>
                          <LocalInput
                            value={home.address_2 || ""}
                            onBlurSave={(val) => patchHomeLocal(home.id, { address_2: val })}
                            disabled={isReadonly}
                            placeholder="Apt 4B"
                          />
                        </Field>
                      </div>
                      <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
                        <Field>
                          <FieldLabel className="text-xs">City</FieldLabel>
                          <LocalInput
                            value={home.city || ""}
                            onBlurSave={(val) => patchHomeLocal(home.id, { city: val })}
                            disabled={isReadonly}
                            placeholder="St. Petersburg"
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">State</FieldLabel>
                          <Combobox
                            value={home.state || ""}
                            onValueChange={(v) => patchHomeLocal(home.id, { state: v as string })}
                          >
                            <ComboboxInput placeholder="Select state" disabled={isReadonly} />
                            <ComboboxContent>
                              <ComboboxList>
                                {US_STATES.map((s) => (
                                  <ComboboxItem key={s.value} value={s.value}>{s.label}</ComboboxItem>
                                ))}
                                <ComboboxEmpty>No state found</ComboboxEmpty>
                              </ComboboxList>
                            </ComboboxContent>
                          </Combobox>
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">ZIP Code</FieldLabel>
                          <LocalInput
                            value={home.zipcode || ""}
                            onBlurSave={(val) => patchHomeLocal(home.id, { zipcode: val })}
                            disabled={isReadonly}
                          />
                        </Field>
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel className="text-xs">
                            Total Value
                          </FieldLabel>
                          <CurrencyInput
                            value={home.total_value ?? 0}
                            onChange={(val) => patchHomeLocal(home.id, { total_value: val })}
                            disabled={isReadonly}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            Outstanding Debt
                          </FieldLabel>
                          <CurrencyInput
                            value={home.outstanding_debt ?? 0}
                            onChange={(val) => patchHomeLocal(home.id, { outstanding_debt: val })}
                            disabled={isReadonly}
                          />
                        </Field>
                      </div>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                </motion.div>
              )}
            </section>

            <Separator />

            {/* Vehicles */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Vehicles
                </h3>
              </div>
              {vehicles.length === 0 ? (
                <Empty className="border rounded-lg py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Car />
                    </EmptyMedia>
                    <EmptyTitle>No Vehicles Listed</EmptyTitle>
                    <EmptyDescription>Add any vehicles owned by your household.</EmptyDescription>
                  </EmptyHeader>
                  {!isReadonly && (
                    <EmptyContent>
                      <Button size="sm" onClick={addVehicle}>Add Vehicle</Button>
                    </EmptyContent>
                  )}
                </Empty>
              ) : (
                <motion.div layout className="space-y-4">
                  <AnimatePresence initial={false}>
                  {vehicles.map((vehicle, idx) => (
                    <motion.div
                      key={vehicle.id}
                      layout
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      className="rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10"
                    >
                      <div className="-mx-4 mb-3 flex items-center justify-between border-b border-foreground/10 px-4 pb-3">
                        <p className="text-sm font-semibold">
                          Vehicle {idx + 1}
                        </p>
                        {!isReadonly && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant={idx === vehicles.length - 1 ? "default" : "outline"}
                              size="sm"
                              onClick={addVehicle}
                              disabled={idx !== vehicles.length - 1}
                            >
                              Add Another Vehicle
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-red-600"
                              onClick={() => setPendingDelete({ type: "vehicle", id: vehicle.id, label: `Vehicle ${idx + 1}` })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Field>
                          <FieldLabel className="text-xs">Type</FieldLabel>
                          <Select
                            value={vehicle.type ?? ""}
                            onValueChange={(val) => {
                              patchVehicleLocal(vehicle.id, { type: val });
                            }}
                            disabled={isReadonly}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Car">Car</SelectItem>
                              <SelectItem value="Truck">Truck</SelectItem>
                              <SelectItem value="SUV">SUV</SelectItem>
                              <SelectItem value="Van">Van</SelectItem>
                              <SelectItem value="Motorcycle">
                                Motorcycle
                              </SelectItem>
                              <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Year</FieldLabel>
                          <LocalInput
                            value={vehicle.car_year ?? ""}
                            onBlurSave={(val) => patchVehicleLocal(vehicle.id, { car_year: val })}
                            disabled={isReadonly}
                            placeholder="e.g. 2020"
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Make</FieldLabel>
                          <LocalInput
                            value={vehicle.car_make ?? ""}
                            onBlurSave={(val) => patchVehicleLocal(vehicle.id, { car_make: val })}
                            disabled={isReadonly}
                            placeholder="e.g. Toyota"
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Model</FieldLabel>
                          <LocalInput
                            value={vehicle.car_model ?? ""}
                            onBlurSave={(val) => patchVehicleLocal(vehicle.id, { car_model: val })}
                            disabled={isReadonly}
                            placeholder="e.g. Camry"
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            Total Value
                          </FieldLabel>
                          <CurrencyInput
                            value={vehicle.total_value ?? 0}
                            onChange={(val) => patchVehicleLocal(vehicle.id, { total_value: val })}
                            disabled={isReadonly}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            Remaining Debt
                          </FieldLabel>
                          <CurrencyInput
                            value={vehicle.remaining_debt ?? 0}
                            onChange={(val) => patchVehicleLocal(vehicle.id, { remaining_debt: val })}
                            disabled={isReadonly}
                          />
                        </Field>
                      </div>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                </motion.div>
              )}
            </section>
          </CardContent>
        </Card>

        {/* Family Contribution & Advocacy */}
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="border-b py-3 !pb-3">
            <CardTitle className="text-lg">
              Contribution &amp; Advocacy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 py-5 bg-gray-50 dark:bg-muted/50">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Family Contribution
              </h3>
              <Field className="max-w-xs">
                <FieldLabel className="text-xs">
                  Monthly Contribution
                </FieldLabel>
                <CurrencyInput
                  value={familyContribution}
                  onChange={setFamilyContribution}
                  disabled={isReadonly}
                />
              </Field>
            </section>

            <Separator />

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Scholarship Advocacy Letter
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Provide a brief overview of your household income, usual expenses, and any special obligations (medical bills, job loss, or caregiving). Clearly state a realistic annual contribution toward tuition and your request for additional tuition funding for your child.
              </p>
              <textarea
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={advocacyLetter}
                onChange={(e) => setAdvocacyLetter(e.target.value)}
                disabled={isReadonly}
                placeholder="Tell us about your family's financial situation and why scholarship assistance is important..."
              />
            </section>

            <Separator />

            {/* Certification & Signature */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Certification &amp; Signature
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Please take a moment to review the application details to confirm everything is correct. If there are any updates or adjustments needed, feel free to make them now or let us know so we can assist.
              </p>
              <p className="text-sm text-muted-foreground mb-3">
                Once you&apos;ve confirmed the application, please sign below and we&apos;ll proceed with the final review of your tuition amount. Should you have any questions or concerns, please don&apos;t hesitate to reach out at{" "}
                <a href="mailto:tward@sailfuture.org" className="text-primary underline">tward@sailfuture.org</a>
                {" "}or{" "}
                <a href="tel:+17279001436" className="text-primary underline">(727) 900-1436</a>
              </p>
              <p className="text-sm font-medium mb-4">
                I hereby certify that all the information provided in this application is accurate and complete to the best of my knowledge. I understand that any falsification or omission of information may result in disqualification from the scholarship program.
              </p>
              <div className="rounded-md border border-input bg-background">
                <SignatureCanvas
                  ref={sigCanvasRef}
                  penColor="black"
                  onEnd={handleSignatureEnd}
                  canvasProps={{
                    className: "w-full rounded-md cursor-crosshair",
                    style: { height: 150 },
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {signatureUploading ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3 animate-spin" /> Saving signature…
                    </span>
                  ) : signatureMeta ? (
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="size-3 text-green-600" /> Signature saved
                    </span>
                  ) : (
                    "Sign above using your mouse or touchscreen"
                  )}
                </p>
                {!isReadonly && (
                  <Button variant="outline" size="sm" onClick={clearSignature}>
                    Clear Signature
                  </Button>
                )}
              </div>
            </section>
          </CardContent>
        </Card>

        <div className="h-20" />
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:left-[var(--sidebar-width)]">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          <Button
            variant="outline"
            onClick={() => router.push(`/apply/year/${yearId}`)}
          >
            &larr; Back to Checklist
          </Button>
          {!isReadonly && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {saving ? "Saving..." : lastSaved ? `Last saved ${formatRelativeTime(lastSaved)}` : ""}
              </span>
              <Button onClick={handleSave} disabled={saving || !isDirty}>
                Save Scholarship Application
              </Button>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {pendingDelete?.label}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface XanoFileMetadata {
  path: string;
  name: string;
  type: string;
  size: number;
  mime: string;
  meta?: Record<string, unknown>;
  url?: string;
  [key: string]: unknown;
}

function IncomeFileUpload({
  label,
  disabled,
  existingFile,
  onUploaded,
  onRemoved,
}: {
  label: string;
  disabled?: boolean;
  existingFile?: XanoFileMetadata | null;
  onUploaded?: (metadata: XanoFileMetadata) => void;
  onRemoved?: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const hasFile = existingFile && Object.keys(existingFile).length > 0 && existingFile.path;
  const [uploaded, setUploaded] = useState<XanoFileMetadata | null>(hasFile ? existingFile : null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function handleFilesChange(newFiles: File[]) {
    setFiles(newFiles);
    setError(null);

    if (newFiles.length === 0) {
      if (uploaded) {
        setConfirmRemove(true);
      }
      return;
    }

    const file = newFiles[0];
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }
      const metadata: XanoFileMetadata = await res.json();
      setUploaded(metadata);
      onUploaded?.(metadata);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setFiles([]);
    } finally {
      setUploading(false);
    }
  }

  function doRemove() {
    setUploaded(null);
    setFiles([]);
    setConfirmRemove(false);
    onRemoved?.();
  }

  if (uploaded && files.length === 0) {
    return (
      <>
        <div className="flex items-center gap-3 rounded-md border border-input bg-background px-4 py-3">
          <CheckCircle2 className="size-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{uploaded.name || "Uploaded file"}</p>
            <p className="text-xs text-muted-foreground">Uploaded successfully</p>
          </div>
          {!disabled && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => setConfirmRemove(true)}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove uploaded file?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the uploaded file. You can upload a new one afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={doRemove}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <div>
      <FileUpload
        maxFiles={1}
        maxSize={10 * 1024 * 1024}
        accept=".pdf,.jpg,.jpeg,.png"
        className="w-full"
        value={files}
        onValueChange={handleFilesChange}
        disabled={disabled || uploading}
      >
        <FileUploadDropzone className="flex-row gap-3 px-4 py-3 cursor-pointer">
          {uploading ? (
            <Loader2 className="size-5 text-muted-foreground animate-spin" />
          ) : (
            <FileUp className="size-5 text-muted-foreground" />
          )}
          <div className="flex-1 text-left">
            <p className="text-sm font-medium">
              {uploading ? "Uploading..." : label}
            </p>
            <p className="text-xs text-muted-foreground">PDF, JPG, or PNG (max 10MB)</p>
          </div>
        </FileUploadDropzone>
        <FileUploadList>
          {files.map((file, i) => (
            <FileUploadItem key={i} value={file}>
              <FileUploadItemPreview />
              <FileUploadItemMetadata />
              <FileUploadItemDelete asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <X className="size-4" />
                </Button>
              </FileUploadItemDelete>
            </FileUploadItem>
          ))}
        </FileUploadList>
      </FileUpload>
      {error && (
        <p className="text-xs text-red-600 mt-1">{error}</p>
      )}
    </div>
  );
}

function StepHeader({
  yearId,
  yearName,
}: {
  yearId: string;
  yearName: string;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={`/apply/year/${yearId}`}>
                {yearName || "Overview"}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={`/apply/year/${yearId}/scholarship`}>
                Financial Aid
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Opportunity Scholarship</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}
