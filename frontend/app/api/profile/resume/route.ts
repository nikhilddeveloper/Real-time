import { NextRequest, NextResponse } from "next/server";

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType?.startsWith("multipart/form-data")) {
      return NextResponse.json({ detail: "Send a multipart resume file." }, { status: 415 });
    }
    const response = await fetch(`${BACKEND_API_URL}/api/profile/resume`, {
      method: "POST",
      headers: { "content-type": contentType },
      body: await request.arrayBuffer(),
      cache: "no-store",
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ detail: "The local resume service is unavailable." }, { status: 503 });
  }
}
