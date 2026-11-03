import { NextResponse } from "next/server";
import { scrapeInstagramComments } from "@/lib/ig-scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    if (!body.url || !body.url.trim()) {
      return NextResponse.json(
        { error: "Por favor, ingresa la URL de una publicación de Instagram." },
        { status: 400 }
      );
    }

    const result = await scrapeInstagramComments(body.url);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Ocurrió un error al extraer los comentarios.",
      },
      { status: 500 }
    );
  }
}
