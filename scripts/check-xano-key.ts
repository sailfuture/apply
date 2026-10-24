/**
 * Offline check that `xanoFetch` sends `Authorization: Bearer
 * $XANO_API_KEY` to the "SFA Registration" API group (`2GcBXyoA`) and
 * to nothing else. `fetch` is stubbed, so nothing leaves the machine
 * and no env file is read: the base URLs and key below are set here.
 *
 *   npx tsx scripts/check-xano-key.ts
 *
 * Exits 1 if any case fails.
 */
import { xanoFetch } from "../lib/xano-fetch";

const HOST = "https://xsc3-mvx7-r86m.n7e.xano.io";
const KEY = "check-key-123";

process.env.XANO_API_BASE_URL = `${HOST}/api:2GcBXyoA`;
process.env.XANO_UPLOAD_URL = `${HOST}/api:2GcBXyoA/upload/attachment`;
process.env.XANO_API_KEY = KEY;

const sent: { url: string; init?: RequestInit }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  sent.push({ url: String(input), init });
  return new Response("[]", { status: 200 });
}) as typeof fetch;

interface Case {
  name: string;
  url: string;
  init?: RequestInit;
  fresh?: boolean;
  keyed: boolean;
  /** Extra assertion on what reached fetch. */
  also?: (init: RequestInit | undefined) => string | null;
}

const cases: Case[] = [
  {
    name: "registration list GET (cached table)",
    url: `${HOST}/api:2GcBXyoA/registration_students`,
    init: { cache: "no-store" },
    keyed: true,
    also: (init) =>
      (init as { next?: { revalidate?: number } } | undefined)?.next
        ?.revalidate === 30
        ? null
        : "Data Cache revalidate was dropped",
  },
  {
    name: "registration GET, fresh",
    url: `${HOST}/api:2GcBXyoA/sms_messages`,
    init: { cache: "no-store" },
    fresh: true,
    keyed: true,
  },
  {
    name: "registration PATCH keeps Content-Type",
    url: `${HOST}/api:2GcBXyoA/registration_families/12`,
    init: {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
    keyed: true,
    also: (init) =>
      new Headers(init?.headers).get("Content-Type") === "application/json"
        ? null
        : "Content-Type was lost",
  },
  {
    name: "registration custom query with ?params",
    url: `${HOST}/api:2GcBXyoA/registration_application_by_family?registration_families_id=4`,
    keyed: true,
  },
  {
    name: "upload/attachment POST",
    url: `${HOST}/api:2GcBXyoA/upload/attachment`,
    init: { method: "POST", body: new FormData() },
    keyed: true,
  },
  {
    name: "Toddle group fJsHVIeC",
    url: `${HOST}/api:fJsHVIeC/teachers_by_admin`,
    keyed: false,
  },
  {
    name: "ops group jzQ2liPL",
    url: `${HOST}/api:jzQ2liPL/laptops`,
    keyed: false,
  },
  {
    name: "vault file on the same host",
    url: `${HOST}/vault/abc/file.pdf`,
    keyed: false,
  },
  {
    name: "lookalike group id",
    url: `${HOST}/api:2GcBXyoAx/registration_students`,
    keyed: false,
  },
  {
    name: "same path on another host",
    url: `https://example.com/api:2GcBXyoA/registration_students`,
    keyed: false,
  },
];

async function main() {
  let failed = 0;

  const run = async (c: Case, expectKey: boolean) => {
    sent.length = 0;
    await xanoFetch(c.url, c.init, { fresh: c.fresh });
    const init = sent[0]?.init;
    const auth = new Headers(init?.headers).get("Authorization");
    const problems: string[] = [];
    if (expectKey && auth !== `Bearer ${KEY}`) problems.push("no key");
    if (!expectKey && auth !== null) problems.push(`key sent (${auth})`);
    const extra = c.also?.(init);
    if (extra) problems.push(extra);
    if (problems.length) failed++;
    console.log(
      `${problems.length ? "FAIL" : "ok  "}  ${expectKey ? "key   " : "no key"}  ${c.name}${
        problems.length ? `  — ${problems.join("; ")}` : ""
      }`
    );
  };

  for (const c of cases) await run(c, c.keyed);

  // Unset key: nothing is sent anywhere, even to the group.
  delete process.env.XANO_API_KEY;
  await run(
    {
      name: "registration GET with XANO_API_KEY unset",
      url: `${HOST}/api:2GcBXyoA/registration_students`,
      keyed: false,
    },
    false
  );

  console.log(failed ? `\n${failed} failed.` : "\nAll cases pass.");
  process.exit(failed ? 1 : 0);
}

main();
