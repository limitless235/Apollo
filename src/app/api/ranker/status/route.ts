import { NextResponse } from "next/server";
import { getRankerStatus } from "@/lib/scoring";

export async function GET() {
  return NextResponse.json(getRankerStatus());
}
