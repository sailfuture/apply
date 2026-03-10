"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  household_contributing_adult: number;
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
  signature: Record<string, unknown> | null;
}

interface ContributingMember {
  id: number;
  first_name: string;
  last_name: string;
  address: string;
}

interface Home {
  id: number;
  type: string;
  address: string;
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

function parseCurrency(val: string): number {
  return Number(val.replace(/[^0-9.-]/g, "")) || 0;
}

function formatCurrencyDisplay(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function CurrencyInput({
  id,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  id?: string;
  value: number;
  onChange: (val: number) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [display, setDisplay] = useState(
    value ? formatCurrencyDisplay(value) : ""
  );

  useEffect(() => {
    setDisplay(value ? formatCurrencyDisplay(value) : "");
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
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          const num = Number(raw) || 0;
          setDisplay(raw ? formatCurrencyDisplay(num) : "");
          onChange(num);
        }}
        onBlur={() => {
          setDisplay(value ? formatCurrencyDisplay(value) : "");
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

  const [members, setMembers] = useState<ContributingMember[]>([]);
  const [homes, setHomes] = useState<Home[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [benefits, setBenefits] = useState<Benefit[]>([]);

  // Main form fields
  const [householdAdults, setHouseholdAdults] = useState(0);
  const [householdChildren, setHouseholdChildren] = useState(0);
  const [householdContributing, setHouseholdContributing] = useState(0);
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
        const data = await scholarshipRes.json();
        if (data) {
          setScholarship(data);
          populateForm(data);
          await loadChildData(data.id);
        }
      }
    } catch (err) {
      console.error("Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, [yearId]);

  function populateForm(s: Scholarship) {
    setHouseholdAdults(s.household_adults);
    setHouseholdChildren(s.household_children);
    setHouseholdContributing(s.household_contributing_adult);
    setNoContributing(s.no_contributing_member);
    setBusinessIncome(s.business_income_monthly);
    setCapitalGains(s.capital_gains_monthly);
    setChildSupport(s.child_support_monthly);
    setAlimony(s.alimony_monthly);
    setTrustsIncome(s.trusts_monthly);
    setOtherIncome(s.other_income_monthly);
    setDescribeOtherIncome(s.describe_other_income);
    setAssetsChecking(s.assets_checking);
    setAssetsSavings(s.assets_savings);
    setAssetsRetirement(s.assets_retirement_savings);
    setAssetsStocks(s.assets_stocks_bonds_securities);
    setAssetsTrusts(s.assets_trusts_inheritance);
    setAssetsBusiness(s.assets_business);
    setDebtsCreditCards(s.debts_credit_cards);
    setDebtsStudentLoans(s.debts_student_loans);
    setDebtsPersonalLoans(s.debts_personal_loans);
    setGovBenefits(s.government_benefits);
    setFamilyContribution(s.family_contribution_per_month);
    setAdvocacyLetter(s.scholarship_advocacy_letter);
  }

  async function loadChildData(scholarshipId: number) {
    const [membersRes, homesRes, vehiclesRes, benefitsRes] = await Promise.all([
      fetch(`/api/scholarship/${scholarshipId}/contributing-members`),
      fetch(`/api/scholarship/${scholarshipId}/homes`),
      fetch(`/api/scholarship/${scholarshipId}/vehicles`),
      fetch(`/api/scholarship/${scholarshipId}/benefits`),
    ]);
    if (membersRes.ok) setMembers(await membersRes.json());
    if (homesRes.ok) setHomes(await homesRes.json());
    if (vehiclesRes.ok) setVehicles(await vehiclesRes.json());
    if (benefitsRes.ok) setBenefits(await benefitsRes.json());
  }

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    try {
      const sid = await ensureScholarship();
      if (!sid) return;

      const res = await fetch(`/api/scholarship/${sid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          household_adults: householdAdults,
          household_children: householdChildren,
          household_contributing_adult: householdContributing,
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
        }),
      });
      if (res.ok) setScholarship(await res.json());
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  }

  // Child item CRUD helpers
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

  async function updateMember(
    id: number,
    data: Partial<ContributingMember>
  ) {
    const res = await fetch(
      `/api/scholarship-items/contributing-members/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
    );
    if (res.ok) {
      const updated = await res.json();
      setMembers(members.map((m) => (m.id === id ? updated : m)));
    }
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

  async function updateHome(id: number, data: Partial<Home>) {
    const res = await fetch(`/api/scholarship-items/homes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const updated = await res.json();
      setHomes(homes.map((h) => (h.id === id ? updated : h)));
    }
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

  async function updateVehicle(id: number, data: Partial<Vehicle>) {
    const res = await fetch(`/api/scholarship-items/vehicles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const updated = await res.json();
      setVehicles(vehicles.map((v) => (v.id === id ? updated : v)));
    }
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

  async function updateBenefit(id: number, data: Partial<Benefit>) {
    const res = await fetch(`/api/scholarship-items/benefits/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const updated = await res.json();
      setBenefits(benefits.map((b) => (b.id === id ? updated : b)));
    }
  }

  async function deleteBenefit(id: number) {
    await fetch(`/api/scholarship-items/benefits/${id}`, { method: "DELETE" });
    setBenefits(benefits.filter((b) => b.id !== id));
  }

  const deadlinePassed = isDeadlinePassed(
    schoolYear?.scholarship_deadline ?? null
  );
  const isReadonly = deadlinePassed;

  if (loading) {
    return (
      <>
        <PageHeader yearName="" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader yearName={schoolYear?.year_name ?? ""} />
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-12 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              Opportunity Scholarship
            </h1>
            <p className="text-muted-foreground text-sm">
              {schoolYear?.year_name} &mdash; Complete all sections below.
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

        {/* Household Information */}
        <Card>
          <CardHeader>
            <CardTitle>Household Information</CardTitle>
            <CardDescription>
              How many people live in the household?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="adults">Adults in Household</Label>
                <Input
                  id="adults"
                  type="number"
                  min={0}
                  value={householdAdults || ""}
                  onChange={(e) =>
                    setHouseholdAdults(Number(e.target.value) || 0)
                  }
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="children">Children in Household</Label>
                <Input
                  id="children"
                  type="number"
                  min={0}
                  value={householdChildren || ""}
                  onChange={(e) =>
                    setHouseholdChildren(Number(e.target.value) || 0)
                  }
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contributing">Contributing Adults</Label>
                <Input
                  id="contributing"
                  type="number"
                  min={0}
                  value={householdContributing || ""}
                  onChange={(e) =>
                    setHouseholdContributing(Number(e.target.value) || 0)
                  }
                  disabled={isReadonly}
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <input
                type="checkbox"
                id="no_contributing"
                checked={noContributing}
                onChange={(e) => setNoContributing(e.target.checked)}
                disabled={isReadonly}
                className="size-4 rounded border"
              />
              <Label htmlFor="no_contributing" className="font-normal">
                No contributing members in the household
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Contributing Members */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Contributing Members</CardTitle>
                <CardDescription>
                  List all adults contributing financially to the household.
                </CardDescription>
              </div>
              {!isReadonly && (
                <Button variant="outline" size="sm" onClick={addMember}>
                  Add Member
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No contributing members added.
              </p>
            ) : (
              <div className="space-y-4">
                {members.map((member, idx) => (
                  <div
                    key={member.id}
                    className="rounded-lg border p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-medium">
                        Member {idx + 1}
                      </p>
                      {!isReadonly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMember(member.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label>First Name</Label>
                        <Input
                          value={member.first_name}
                          onChange={(e) =>
                            updateMember(member.id, {
                              first_name: e.target.value,
                            })
                          }
                          disabled={isReadonly}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Last Name</Label>
                        <Input
                          value={member.last_name}
                          onChange={(e) =>
                            updateMember(member.id, {
                              last_name: e.target.value,
                            })
                          }
                          disabled={isReadonly}
                        />
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2">
                      <Label>Address</Label>
                      <Input
                        value={member.address}
                        onChange={(e) =>
                          updateMember(member.id, {
                            address: e.target.value,
                          })
                        }
                        disabled={isReadonly}
                        placeholder="Street address"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Income */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Income</CardTitle>
            <CardDescription>
              Report all sources of monthly household income.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Business Income</Label>
                <CurrencyInput
                  value={businessIncome}
                  onChange={setBusinessIncome}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Capital Gains</Label>
                <CurrencyInput
                  value={capitalGains}
                  onChange={setCapitalGains}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Child Support</Label>
                <CurrencyInput
                  value={childSupport}
                  onChange={setChildSupport}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Alimony</Label>
                <CurrencyInput
                  value={alimony}
                  onChange={setAlimony}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Trusts</Label>
                <CurrencyInput
                  value={trustsIncome}
                  onChange={setTrustsIncome}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Other Income</Label>
                <CurrencyInput
                  value={otherIncome}
                  onChange={setOtherIncome}
                  disabled={isReadonly}
                />
              </div>
            </div>
            {otherIncome > 0 && (
              <div className="mt-4 grid gap-2">
                <Label>Describe Other Income</Label>
                <Input
                  value={describeOtherIncome}
                  onChange={(e) => setDescribeOtherIncome(e.target.value)}
                  disabled={isReadonly}
                  placeholder="Describe the source of other income"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assets */}
        <Card>
          <CardHeader>
            <CardTitle>Assets</CardTitle>
            <CardDescription>
              Report the current value of household assets.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Checking Accounts</Label>
                <CurrencyInput
                  value={assetsChecking}
                  onChange={setAssetsChecking}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Savings Accounts</Label>
                <CurrencyInput
                  value={assetsSavings}
                  onChange={setAssetsSavings}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Retirement / Savings</Label>
                <CurrencyInput
                  value={assetsRetirement}
                  onChange={setAssetsRetirement}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Stocks / Bonds / Securities</Label>
                <CurrencyInput
                  value={assetsStocks}
                  onChange={setAssetsStocks}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Trusts / Inheritance</Label>
                <CurrencyInput
                  value={assetsTrusts}
                  onChange={setAssetsTrusts}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Business</Label>
                <CurrencyInput
                  value={assetsBusiness}
                  onChange={setAssetsBusiness}
                  disabled={isReadonly}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Debts */}
        <Card>
          <CardHeader>
            <CardTitle>Debts</CardTitle>
            <CardDescription>
              Report outstanding household debts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Credit Cards</Label>
                <CurrencyInput
                  value={debtsCreditCards}
                  onChange={setDebtsCreditCards}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Student Loans</Label>
                <CurrencyInput
                  value={debtsStudentLoans}
                  onChange={setDebtsStudentLoans}
                  disabled={isReadonly}
                />
              </div>
              <div className="grid gap-2">
                <Label>Personal Loans</Label>
                <CurrencyInput
                  value={debtsPersonalLoans}
                  onChange={setDebtsPersonalLoans}
                  disabled={isReadonly}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Government Benefits */}
        <Card>
          <CardHeader>
            <CardTitle>Government Benefits</CardTitle>
            <CardDescription>
              Does your household receive government assistance?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="gov_benefits"
                checked={govBenefits}
                onChange={(e) => setGovBenefits(e.target.checked)}
                disabled={isReadonly}
                className="size-4 rounded border"
              />
              <Label htmlFor="gov_benefits" className="font-normal">
                My household receives government benefits
              </Label>
            </div>
            {govBenefits && (
              <div className="mt-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium">Benefit Types</p>
                  {!isReadonly && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addBenefit}
                    >
                      Add Benefit
                    </Button>
                  )}
                </div>
                {benefits.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No benefits listed.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {benefits.map((benefit) => (
                      <div
                        key={benefit.id}
                        className="flex items-end gap-3"
                      >
                        <div className="grid flex-1 gap-2">
                          <Label>Type</Label>
                          <Select
                            value={benefit.type}
                            onValueChange={(val) =>
                              updateBenefit(benefit.id, { type: val })
                            }
                            disabled={isReadonly}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="SNAP">SNAP</SelectItem>
                              <SelectItem value="Medicaid">
                                Medicaid
                              </SelectItem>
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
                        </div>
                        <div className="grid w-40 gap-2">
                          <Label>Monthly Amount</Label>
                          <CurrencyInput
                            value={benefit.amount_monthly}
                            onChange={(val) =>
                              updateBenefit(benefit.id, {
                                amount_monthly: val,
                              })
                            }
                            disabled={isReadonly}
                          />
                        </div>
                        {!isReadonly && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteBenefit(benefit.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Home / Real Estate */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Home / Real Estate</CardTitle>
                <CardDescription>
                  List all properties owned by household members.
                </CardDescription>
              </div>
              {!isReadonly && (
                <Button variant="outline" size="sm" onClick={addHome}>
                  Add Property
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {homes.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No properties listed.
              </p>
            ) : (
              <div className="space-y-4">
                {homes.map((home, idx) => (
                  <div key={home.id} className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-medium">
                        Property {idx + 1}
                      </p>
                      {!isReadonly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteHome(home.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label>Type</Label>
                        <Select
                          value={home.type}
                          onValueChange={(val) =>
                            updateHome(home.id, { type: val })
                          }
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
                      </div>
                      <div className="grid gap-2">
                        <Label>Address</Label>
                        <Input
                          value={home.address}
                          onChange={(e) =>
                            updateHome(home.id, {
                              address: e.target.value,
                            })
                          }
                          disabled={isReadonly}
                          placeholder="Property address"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Total Value</Label>
                        <CurrencyInput
                          value={home.total_value}
                          onChange={(val) =>
                            updateHome(home.id, { total_value: val })
                          }
                          disabled={isReadonly}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Outstanding Debt</Label>
                        <CurrencyInput
                          value={home.outstanding_debt}
                          onChange={(val) =>
                            updateHome(home.id, {
                              outstanding_debt: val,
                            })
                          }
                          disabled={isReadonly}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vehicles */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Vehicles</CardTitle>
                <CardDescription>
                  List all vehicles owned by household members.
                </CardDescription>
              </div>
              {!isReadonly && (
                <Button variant="outline" size="sm" onClick={addVehicle}>
                  Add Vehicle
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {vehicles.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No vehicles listed.
              </p>
            ) : (
              <div className="space-y-4">
                {vehicles.map((vehicle, idx) => (
                  <div
                    key={vehicle.id}
                    className="rounded-lg border p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-medium">
                        Vehicle {idx + 1}
                      </p>
                      {!isReadonly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteVehicle(vehicle.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label>Type</Label>
                        <Select
                          value={vehicle.type}
                          onValueChange={(val) =>
                            updateVehicle(vehicle.id, { type: val })
                          }
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
                      </div>
                      <div className="grid gap-2">
                        <Label>Year</Label>
                        <Input
                          value={vehicle.car_year}
                          onChange={(e) =>
                            updateVehicle(vehicle.id, {
                              car_year: e.target.value,
                            })
                          }
                          disabled={isReadonly}
                          placeholder="e.g. 2020"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Make</Label>
                        <Input
                          value={vehicle.car_make}
                          onChange={(e) =>
                            updateVehicle(vehicle.id, {
                              car_make: e.target.value,
                            })
                          }
                          disabled={isReadonly}
                          placeholder="e.g. Toyota"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Model</Label>
                        <Input
                          value={vehicle.car_model}
                          onChange={(e) =>
                            updateVehicle(vehicle.id, {
                              car_model: e.target.value,
                            })
                          }
                          disabled={isReadonly}
                          placeholder="e.g. Camry"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Total Value</Label>
                        <CurrencyInput
                          value={vehicle.total_value}
                          onChange={(val) =>
                            updateVehicle(vehicle.id, {
                              total_value: val,
                            })
                          }
                          disabled={isReadonly}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Remaining Debt</Label>
                        <CurrencyInput
                          value={vehicle.remaining_debt}
                          onChange={(val) =>
                            updateVehicle(vehicle.id, {
                              remaining_debt: val,
                            })
                          }
                          disabled={isReadonly}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Family Contribution */}
        <Card>
          <CardHeader>
            <CardTitle>Family Contribution</CardTitle>
            <CardDescription>
              How much can your family contribute monthly toward tuition?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-xs">
              <Label>Monthly Contribution</Label>
              <CurrencyInput
                value={familyContribution}
                onChange={setFamilyContribution}
                disabled={isReadonly}
              />
            </div>
          </CardContent>
        </Card>

        {/* Advocacy Letter */}
        <Card>
          <CardHeader>
            <CardTitle>Scholarship Advocacy Letter</CardTitle>
            <CardDescription>
              Please describe why your family is seeking scholarship
              assistance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={advocacyLetter}
              onChange={(e) => setAdvocacyLetter(e.target.value)}
              disabled={isReadonly}
              rows={6}
              placeholder="Tell us about your family's financial situation and why scholarship assistance is important..."
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => router.push(`/apply/year/${yearId}`)}
          >
            Back to {schoolYear?.year_name ?? "School Year"}
          </Button>

          {!isReadonly && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Application"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function PageHeader({ yearName }: { yearName: string }) {
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
              <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/apply">Applications</BreadcrumbLink>
            </BreadcrumbItem>
            {yearName && (
              <>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href={`/apply`}>
                    {yearName}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
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
