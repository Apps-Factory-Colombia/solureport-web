import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getRuntimeEnv(name: string): string | undefined {
  const env = process.env as Record<string, string | undefined>;
  return env[name]?.trim() || undefined;
}

export async function GET() {
  // Keep the public Supabase configuration runtime-based so a Docker image
  // can be built once and configured later by Dockploy.
  const url = getRuntimeEnv("SOLUREPORT_SUPABASE_URL")
    || getRuntimeEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = getRuntimeEnv("SOLUREPORT_SUPABASE_PUBLISHABLE_KEY")
    || getRuntimeEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    || getRuntimeEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  if (!url || !publishableKey) {
    return NextResponse.json(
      { configured: false, error: "Falta la configuración pública de Supabase Storage en el contenedor." },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  return NextResponse.json(
    { configured: true, url, publishableKey },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
