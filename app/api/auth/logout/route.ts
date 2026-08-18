import { NextRequest, NextResponse } from "next/server";
import { revokeSession } from "@/lib/db/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ data: true });
  try {
    await revokeSession(request, response);
  } catch (error) {
    console.error("Error cerrando sesión:", error);
  }
  return response;
}
