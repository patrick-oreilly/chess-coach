import { NextResponse } from "next/server";
import { syncRecentGames } from "@/lib/analyzer";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: number;
      timeClass?: string;
    };
    const result = await syncRecentGames({
      limit: body.limit ?? 20,
      timeClass: body.timeClass ?? "rapid",
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to sync games";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
