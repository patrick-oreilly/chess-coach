import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    username?: string;
    deepSeekApiKey?: string;
  };

  if (typeof body.username === "string" && body.username.trim()) {
    setSetting("CHESSCOM_USERNAME", body.username.trim());
  }
  if (typeof body.deepSeekApiKey === "string") {
    setSetting("DEEPSEEK_API_KEY", body.deepSeekApiKey.trim());
  }

  const username = getSetting("CHESSCOM_USERNAME", "patrickoreilly2");
  const deepSeekKey = getSetting("DEEPSEEK_API_KEY", "").trim();

  return NextResponse.json({
    username,
    hasDeepSeekKey: Boolean(deepSeekKey),
    maskedDeepSeekKey: deepSeekKey ? `${deepSeekKey.slice(0, 6)}•••${deepSeekKey.slice(-4)}` : "",
  });
}
