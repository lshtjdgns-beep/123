import { NextResponse } from "next/server";
import { getNetworkInfo } from "@/server/networkInfo";

export async function GET(req: Request) {
  const port = Number(new URL(req.url).port) || 3000;
  return NextResponse.json(await getNetworkInfo(port));
}
