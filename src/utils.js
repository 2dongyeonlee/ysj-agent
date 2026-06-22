// utils.js - shared formatting helpers for project/info/briefing outputs.

export function stripHtml(text) {
  return String(text || "").replace(/<\/?[a-zA-Z]+>/g, "").replace(/\s+/g, " ").trim();
}

// 앞쪽 호칭·인사말(사장님/위원장님/회장님 …)을 제거. "사장님," "사장님." "○○위원장님께" 등.
// 보고문이 인사말로 시작해 요약 첫 문장이 "사장님."만 남는 것을 막는다.
export function stripSalutation(text) {
  let t = String(text || "").trim();
  const sal = /^(사장님|위원장님|회장님|의장님|부사장님|대표님|차관님|장관님|위원님)\s*(께서|께|에게)?\s*[,.，．:：·ㆍ\-–—]?\s*/;
  for (let i = 0; i < 3 && sal.test(t); i++) t = t.replace(sal, "").trim();
  return t || String(text || "").trim();
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
  const source = stripSalutation(bullet ? bullet[1].trim() : cleaned);
  const sentence = stripSalutation(source.split(/(?<=[.!?。！？])\s+/u)[0] || source);
  const out = sentence.trim();
  if (out.length <= limit) return out;
  const cut = out.slice(0, limit + 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > 35 ? cut.slice(0, sp) : out.slice(0, limit)).trim() + "…";
}

export const firstSentence = oneLine;

function cleanMonthDay(month, day) {
  let m = Number(month);
  let d = Number(day);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return "";
  if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return m + "/" + d;
  if (m > 12 && m <= 31 && d >= 1 && d <= 12) return d + "/" + m;
  return "";
}

export function issueDate(row) {
  const source = String(row.schedule || "") + "\n" + String(row.summary || "");
  const full = source.match(/20\d{2}[-.\s년]+(\d{1,2})[-.\s월]+(\d{1,2})/);
  if (full) {
    const v = cleanMonthDay(full[1], full[2]);
    if (v) return v;
  }
  const slash = source.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?:[^\d]|$)/);
  if (slash) {
    const v = cleanMonthDay(slash[1], slash[2]);
    if (v) return v;
  }
  const dotted = source.match(/(?:^|[^\d])(\d{1,2})\.(\d{1,2})(?:[^\d]|$)/);
  if (dotted) {
    const v = cleanMonthDay(dotted[1], dotted[2]);
    if (v) return v;
  }
  const korean = source.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) {
    const v = cleanMonthDay(korean[1], korean[2]);
    if (v) return v;
  }
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
