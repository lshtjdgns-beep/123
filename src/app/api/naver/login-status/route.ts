import { NextResponse } from "next/server";
import { getLoginStatus } from "@/server/naver/auth";

export async function GET() {
  return NextResponse.json(getLoginStatus());
}
