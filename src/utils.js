// utils.js — project/info/briefing 공통 함수 단일 소스.
// 중복 제거: stripHtml, truncateWords(삭제·문장보존), oneLine/firstSentence(머리표 제거·끊김 없음),
// issueDate, senderTag, sinceDaysIso 를 여기 한 곳에서 관리한다.

export function stripHtml(text) {
  return String(text || "").replace(/<\/?[a-zA-Z]+>/g, "").replace(/\s+/g, " ").trim();
}

// 핵심 한 줄 요약. 글자수로 자르지 않는다(말 끊김 방지). 머리표 제거. 첫 문장만.
export function oneLine(text) {
  const cleaned = stripHtml(text)
    .replace(/^📋\s*[^📌\n]+/u, "")
    .replace(/^📄\s*[^🎯\n]+/u, "")
    .replace(/📌\s*핵심\s*/g, "")
    .replace(/🎯\s*핵심:\s*/g, "")
    .replace(/\[(보고요망|보고|공유|참고|검토요망|검토|긴급|중요)\]\s*/g, "")
    .replace(/^[•\-]\s*/g, "")
    .trim();
  const bullet = cleaned.match(/(?:^|\s)•\s*([^•\n]+)/);
  const source = bullet ? bullet[1].trim() : cleaned;
  const sentence = source.split(/(?<=[.!?。]|다\.|임\.|음\.)\s+/u)[0] || source;
  return sentence.trim();
}

// firstSentence 는 oneLine 의 별칭(기존 호출 호환).
export const firstSentence = oneLine;

// 날짜 추출: schedule/summary 에서 m/d 또는 '월일' 패턴.
export function issueDate(row) {
  const source = String(row.schedule || "") + "\n" + String(row.summary || "");
  const full = source.match(/20\d{2}[-.년]\s*(\d{1,2})[-.월]\s*(\d{1,2})/);
  if (full) return Number(full[1]) + "/" + Number(full[2]);
  const slash = source.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) return Number(slash[1]) + "/" + Number(slash[2]);
  const dotted = source.match(/(\d{1,2})\.(\d{1,2})/);
  if (dotted) return Number(dotted[1]) + "/" + Number(dotted[2]);
  const korean = source.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) return Number(korean[1]) + "/" + Number(korean[2]);
  return "—";
}

// 정렬용 점수.
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

// 공유자(보낸 사람) 태그. " (이름)" 형태. 없으면 빈 문자열.
export function senderTag(row) {
  const raw = String(row.sender || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return " (" + raw.slice(0, 20) + ")";
}

// 인물 추출: people 필드 우선, 없으면 빈 문자열.
export function peopleText(row) {
  const p = String(row.people || "").trim();
  return p;
}

// N일 전 ISO. days=1 이면 어제 0시 기준(전날+당일 포함하려면 호출부에서 days=2 등 조정).
export function sinceDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - (days || 1));
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// 표준 한 줄 포맷: (날짜) 내용 (공유자)
export function formatLine(row) {
  const date = issueDate(row);
  const body = oneLine(row.summary);
  const who = senderTag(row);
  return "• [" + date + "] " + body + who;
}
