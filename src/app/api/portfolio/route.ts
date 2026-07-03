import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import {
  getPortfolioHoldings,
  addPortfolioHolding,
  updatePortfolioHolding,
  removePortfolioHolding,
} from "@/lib/portfolio";

export async function GET() {
  initDb();
  const items = await getPortfolioHoldings();
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  initDb();
  try {
    const body = await request.json();
    const item = await addPortfolioHolding(body);
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add holding" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  initDb();
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const item = await updatePortfolioHolding(id, body);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update holding" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  initDb();
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const removed = await removePortfolioHolding(id);
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
