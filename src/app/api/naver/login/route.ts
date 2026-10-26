import { NextResponse } from "next/server";
import { cancelLogin, getLoginStatus, startManualLogin } from "@/server/naver/auth";
import { jsonError } from "@/server/http";

/** PC 화면 로그인 시작(창이 PC 모니터에 뜬다) */
export async function POST() {
  try {
    return NextResponse.json(await startManualLogin());
  } catch (e) {
    return jsonError(e);
  }
}

export async function GET() {
  return NextResponse.json(getLoginStatus());
}

/** 꼬였을 때 폰에서도 강제 정리 */
export async function DELETE() {
  return NextResponse.json(await cancelLogin());
}
