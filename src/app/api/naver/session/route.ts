import { NextResponse } from "next/server";
import { isSessionValid } from "@/server/naver/auth";
import { jsonError } from "@/server/http";

export async function GET() {
  try {
    return NextResponse.json(await isSessionValid());
  } catch (e) {
    return jsonError(e);
  }
}
