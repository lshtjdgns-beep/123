import { NextResponse } from "next/server";
import { checkClaudeCredentialsLocal, generateText, withTimeout } from "@/server/ai/claudeClient";
import { jsonError } from "@/server/http";

/** 네트워크 호출 없이 로컬 자격 파일만으로 즉시 판단 */
export async function GET() {
  return NextResponse.json(checkClaudeCredentialsLocal());
}

/** 실제 호출 테스트(짧은 프롬프트, 60초 제한) */
export async function POST() {
  const local = checkClaudeCredentialsLocal();
  if (!local.ok) return NextResponse.json(local, { status: 401 });
  try {
    const started = Date.now();
    const text = await withTimeout(generateText("'확인'이라고만 답하세요.", { lightweight: true }), 60_000, "Claude 호출 테스트");
    return NextResponse.json({ ...local, live: true, reply: text.trim().slice(0, 50), ms: Date.now() - started });
  } catch (e) {
    return jsonError(e, 502);
  }
}
