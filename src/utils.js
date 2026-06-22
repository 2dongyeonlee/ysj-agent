// utils.js - shared formatting helpers for project/info/briefing outputs.

export function stripHtml(text) {
  return String(text || "").replace(/<\/?[a-zA-Z]+>/g, "").replace(/\s+/g, " ").trim();
}

export function oneLine(text, limit = 90) {
  const cleaned = stripHtml(text)
    .replace(/^📄\s*[^🎯\n]+/u, "")
    .replace(/^📋\s*[^📌\n]+/u, "")
    .replace(/🎯\s*핵심:\s*/g, "")
    .replace(/📌\s*핵심:\s*/g, "")
    .replace(/\[(보고요망|보고|공유|참고|검토요망|검토|긴급|중요)\]\s*/g, "")
    .replace(/^[•\-]\s*/g, "")
    .trim();
  const bullet = cleaned.match(/(?:^|\s)•\s*([^•\n]+)/);
  const source = bullet ? bullet[1].trim() : cleaned;
  const sentence = source.split(/(?<=[.!?。！？])\s+/u)[0] || source;
  const out = sentence.trim();
  if (out.length <= limit) return out;
  const cut = out.slice(0, limit + 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > 35 ? cut.slice(0, sp) : out.slice(0, limit)).trim() + "…";
}

export const firstSentence = oneLine;

export function issueDate(row) {
  const source = String(row.schedule || "") + "\n" + String(row.summary || "");
  const full = source.match(/20\d{2}[-.\s년]+(\d{1,2})[-.\s월]+(\d{1,2})/);
  if (full) return Number(full[1]) + "/" + Number(full[2]);
  const slash = source.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) return Number(slash[1]) + "/" + Number(slash[2]);
  const dotted = source.match(/(\d{1,2})\.(\d{1,2})/);
  if (dotted) return Number(dotted[1]) + "/" + Number(dotted[2]);
  const korean = source.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) return Number(korean[1]) + "/" + Number(korean[2]);
  if (row && row.created_at) {
    const t = Date.parse(String(row.created_at).replace(" ", "T") + "Z");
    if (!isNaN(t)) {
      const k = new Date(t + 9 * 3600 * 1000);
      return (k.getUTCMonth() + 1) + "/" + k.getUTCDate();
    }
  }
  return "—";
}

export function issueScore(row) {
  const text = issueDate(row);
  if (text === "—") return 9999;
  const parts = text.split("/");
  const month = parseInt(parts[0], 10);
  const day = parts[1] ? parseInt(parts[1], 10) : 15;
  return month * 100 + day;
}

export function sortByIssueDate(a, b) {
  return issueScore(a) - issueScore(b);
}

export function senderTag(row) {
  const raw = String(row.sender || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const name = raw.split(" ")[0] || raw;
  return " (" + name.slice(0, 20) + ")";
}

export function peopleText(row) {
  return String(row.people || "").trim();
}

export function sinceDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - (days || 1));
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function formatLine(row) {
  return "• [" + issueDate(row) + "] " + oneLine(row.summary) + senderTag(row);
}
