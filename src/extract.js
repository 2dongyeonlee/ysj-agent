// extract.js — detect "who was met" from messages and accumulate into engagements.
// Called from collect. Feeds contact/meeting-prep briefings.

import { callClaude, MODEL_FAST } from "./claude.js";
import { findContact, insertContact, insertEngagement } from "./db.js";

// 1st-pass keyword filter (cheap). Only run LLM when a meeting signal is present.
const SIGNAL = /(미팅|면담|오찬|만찬|대면|만났|만나|회동|간담|통화|방문|접견|참석)/;

const EXTRACT_SYSTEM =
  "You extract meeting/contact records from a Korean message. " +
  "Return ONLY a JSON object, no other text, no markdown fences. " +
  "If the message does not describe an actual meeting/contact with a person, return {\"found\":false}. " +
  "Otherwise return: " +
  "{\"found\":true,\"name\":\"person name\",\"org\":\"affiliation\",\"topic\":\"subject\",\"channel\":\"대면/통화/오찬/행사 etc\",\"summary\":\"1-line Korean summary\",\"followup\":\"next action or empty\"}. " +
  "All string values in Korean. Use empty string for unknown fields.";

export async function maybeExtractEngagement(env, msg, text) {
  if (!text || !SIGNAL.test(text)) return null; // cheap filter
  if (text.length < 8) return null;

  let parsed;
  try {
    const raw = await callClaude(env, "메시지:\n" + text.slice(0, 1500), EXTRACT_SYSTEM, MODEL_FAST, 400);
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("extract parse error", e && e.message);
    return null;
  }

  if (!parsed || !parsed.found || !parsed.name) return null;

  // contact match by name/alias; create if missing
  let contactId;
  try {
    const hits = await findContact(env, parsed.name);
    if (hits && hits.length) {
      contactId = hits[0].id;
    } else {
      contactId = await insertContact(env, {
        name: parsed.name,
        org: parsed.org || "",
        rel_type: "",
        aliases: "",
      });
    }
  } catch (e) {
    console.error("contact match error", e && e.message);
    contactId = null;
  }

  // insert engagement
  try {
    await insertEngagement(env, {
      contact_id: contactId,
      met_at: new Date().toISOString().slice(0, 10),
      topic: parsed.topic || "",
      channel: parsed.channel || "",
      summary: parsed.summary || "",
      followup: parsed.followup || "",
      source_type: "message",
      source_ref: String(msg.message_id || ""),
      raw_input: text.slice(0, 1000),
      created_by: (msg.from && msg.from.first_name) || "",
    });
    console.log("engagement saved:", parsed.name, parsed.topic);
  } catch (e) {
    console.error("insertEngagement error", e && e.message);
  }
  return contactId;
}
