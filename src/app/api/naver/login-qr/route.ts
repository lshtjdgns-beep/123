import { NextResponse } from "next/server";
import { cancelLogin, getLoginStatus, startQrLogin } from "@/server/naver/auth";
import { jsonError } from "@/server/http";

export async function POST() {
  try {
    return NextResponse.json(await startQrLogin());
  } catch (e) {
    return jsonError(e);
  }
}

export async function GET() {
  return NextResponse.json(getLoginStatus());
}

export async function DELETE() {
  return NextResponse.json(await cancelLogin());
}
