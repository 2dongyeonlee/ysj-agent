// people.js — ysj-agent 발신자 명단 (텔레그램 export 추출 기반)
// full = 정식 한글명 / telegram·english·extra = 추가 표기(별칭)
// buildNameAliases 가 full 에서 "성+이름","이름","이름 성"을 자동 생성하므로
// 한글 "이름 성"(예: 성진 염) 표기는 따로 등록할 필요 없음.

export const PEOPLE = [
  { full: "염성진",  extra: ["사장님"] },          // 성진 염
  { full: "권오혁",  extra: ["권오혁(A)"] },        // 권오혁
  { full: "이동연",  extra: ["이동연(A)"] },        // 동연 이  (id:user5965410906)
  { full: "김선영" },                              // 선영 김  (id:user624410079)
  { full: "황무연",  english: "Moo Yeon Hwang" },  // Moo Yeon Hwang
  { full: "함동균" },                              // 동균 함
  { full: "손경배" },                              // 손경배 / 경배
  { full: "황혜주" },                              // 혜주 황
  { full: "박호현" },                              // 박호현
  { full: "한혜승" },                              // 혜승 한
  { full: "구정모" },                              // 구정모
  { full: "곽승균" },                              // 승균 곽
  { full: "양서진" },                              // 서진 양

  // ── 1건 공유 (관계사·외부 가능성, 불필요하면 줄 삭제) ──
  { full: "윤성은" },                              // 성은 윤
  { full: "김민재" },                              // 민재 김 / 김민재
  { full: "방민영" },                              // 민영 방
  { full: "최광석" },                              // 최광석
  { full: "최지훈" },                              // 최지훈
  { full: "안준현" },                              // 준현 안
  { full: "김광호",  extra: ["kwangho_kim"] },     // kwangho_kim (한글명 추정)
  { full: "김동미",  english: "Dongmi Kim" },      // Dongmi Kim (한글명 추정)
];

function buildNameAliases(people) {
  const result = {};
  for (const p of people) {
    const full = p.full;
    const lastName = full.slice(0, 1);
    const firstName = full.slice(1);
    const variants = new Set([full, firstName, `${firstName} ${lastName}`]);
    (p.telegram || []).forEach(t => variants.add(t));
    if (p.english) { variants.add(p.english); variants.add(p.english.split(" ")[0]); }
    (p.extra || []).forEach(e => variants.add(e));
    result[full] = [...variants];
  }
  return result;
}
export const NAME_ALIASES = buildNameAliases(PEOPLE);
