import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextRequest } from "next/server";
import { xano } from "@/lib/xano";

function cleanPhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const evt = await verifyWebhook(req);
    const eventType = evt.type;

    if (eventType === "user.created") {
      const { id, email_addresses, first_name, last_name, phone_numbers } =
        evt.data;

      const primaryEmail =
        email_addresses?.find(
          (e) => e.id === evt.data.primary_email_address_id
        )?.email_address ?? "";

      const primaryPhone = cleanPhone(
        phone_numbers?.find(
          (p) => p.id === evt.data.primary_phone_number_id
        )?.phone_number ?? ""
      );

      const existingParent = await xano.parents.findByEmail(primaryEmail);

      if (existingParent && existingParent.invite_status === "pending") {
        await xano.parents.update(existingParent.id, {
          clerk_user_id: id,
          first_name: first_name ?? existingParent.first_name,
          last_name: last_name ?? existingParent.last_name,
          phone: primaryPhone || existingParent.phone,
          invite_status: "active",
        });
        console.log(`Linked invited parent ${existingParent.id} to Clerk user ${id}`);
      } else {
        await xano.parents.create({
          clerk_user_id: id,
          first_name: first_name ?? "",
          last_name: last_name ?? "",
          email: primaryEmail,
          phone: primaryPhone,
          relationship: "",
          invite_status: "active",
        });
        console.log(`Created new parent record for Clerk user ${id}`);
      }
    }

    if (eventType === "user.updated") {
      const { id, email_addresses, first_name, last_name, phone_numbers } =
        evt.data;

      const primaryEmail =
        email_addresses?.find(
          (e) => e.id === evt.data.primary_email_address_id
        )?.email_address ?? "";

      const primaryPhone = cleanPhone(
        phone_numbers?.find(
          (p) => p.id === evt.data.primary_phone_number_id
        )?.phone_number ?? ""
      );

      const parent = await xano.parents.findByClerkId(id);
      if (parent) {
        await xano.parents.update(parent.id, {
          first_name: first_name ?? parent.first_name,
          last_name: last_name ?? parent.last_name,
          email: primaryEmail || parent.email,
          phone: primaryPhone || parent.phone,
        });
        console.log(`Updated parent record for Clerk user ${id}`);
      }
    }

    if (eventType === "user.deleted") {
      const parent = await xano.parents.findByClerkId(evt.data.id ?? "");
      if (parent) {
        const family = await xano.families.findByParentId(parent.id);
        if (family) {
          const existingIds = xano.families.getParentIds(family);
          await xano.families.update(family.id, {
            registration_parents_id: existingIds.filter(
              (pid) => pid !== parent.id
            ),
          });
        }
        await xano.parents.delete(parent.id);
        console.log(`Deleted parent ${parent.id} and unlinked from family`);
      }
    }

    return new Response("Webhook received", { status: 200 });
  } catch (err) {
    console.error("Error processing webhook:", err);
    return new Response("Error processing webhook", { status: 400 });
  }
}
