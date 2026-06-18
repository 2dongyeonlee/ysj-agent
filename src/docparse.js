// docparse.js — 파일에서 텍스트 추출. summarize/retrieve 가 공용으로 쓰는 헬퍼.
// KOH봇 extractDocumentText/extractOfficeText/describeImage 를 여기로 이식.
// [stub] PDF/DOCX/이미지 처리는 KOH봇 코드 이식 시 채운다.

export async function extractText(env, msg) {
  // TODO:
  //  - msg.document 가 PDF/DOCX → 텍스트 추출 (KOH extractDocumentText 이식)
  //  - msg.photo → describeImage(Vision)로 설명 텍스트
  //  - 이미지 박힌 PPT/스캔본은 OCR 한계 (KOH봇도 못 함)
  return ""; // 추출 텍스트
}
