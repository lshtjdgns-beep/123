import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonError(e: unknown, status = 500) {
  if (e instanceof ZodError) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다.", issues: e.issues }, { status: 400 });
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: message }, { status });
}
