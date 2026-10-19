import { NextRequest, NextResponse } from "next/server";

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType?.startsWith("multipart/form-data")) {
      return NextResponse.json(
        { detail: "Send the question as a multipart audio upload." },
        { status: 415 },
      );
    }

    const requestBody = await request.arrayBuffer();
    const response = await fetch(`${BACKEND_API_URL}/api/coach`, {
      method: "POST",
      headers: { "content-type": contentType },
      body: requestBody,
      cache: "no-store",
    });

    const responseContentType =
      response.headers.get("content-type") ?? "application/json";
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "content-type": responseContentType },
    });
  } catch {
    return NextResponse.json(
      { detail: "The local coaching backend is unavailable. Start it with python app.py." },
      { status: 503 },
    );
  }
}
