import { NextRequest } from "next/server";
import { readTwilioWebhook, twiml } from "@/lib/twilio-webhook";
import { MAIN_LINE } from "@/lib/school-phones";

/**
 * Voice webhook for the texting number, (727) 604-8321. A parent who
 * calls back the number that texted them used to hear Twilio's demo
 * greeting; now the call rings the office Main Line in Quo.
 *
 * `<Dial>` on an inbound call shows the dialed party the ORIGINAL
 * caller's number (Twilio default), so the call lands in Quo under the
 * parent's own number — the same conversation their calls to the Main
 * Line already live in. `answerOnBridge` keeps the caller hearing
 * ringback until the Main Line (or its voicemail) actually picks up.
 * The 60-second ring outlasts Quo's own ring-to-voicemail time, so
 * Quo's voicemail normally answers; the spoken line after <Dial> only
 * plays if nothing picks up at all.
 */
export async function POST(req: NextRequest) {
  const parsed = await readTwilioWebhook(req, "/api/webhooks/twilio/voice");
  if (!parsed.ok) return parsed.response;
  return twiml(
    `<Dial answerOnBridge="true" timeout="60"><Number>${MAIN_LINE}</Number></Dial>` +
      `<Say>Sorry, we couldn't take your call. Please call the SailFuture Academy office at 7 2 7, 2 0 9, 7 8 4 6, or reply to our text message.</Say>`
  );
}
