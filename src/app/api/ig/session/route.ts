import { NextResponse } from "next/server";
import {
  clearSession,
  getSessionStatus,
  launchInteractiveLogin,
  saveManualSessionCookie,
} from "@/lib/ig-scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = getSessionStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : "Error al verificar la sesión.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "browser-login" | "cookie";
      sessionId?: string;
    };

    if (body.action === "cookie") {
      if (!body.sessionId) {
        return NextResponse.json(
          { error: "Ingresa el valor de la cookie sessionid." },
          { status: 400 }
        );
      }
      const status = saveManualSessionCookie(body.sessionId);
      return NextResponse.json(status);
    }

    const status = await launchInteractiveLogin();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo conectar la sesión de Instagram.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    clearSession();
    return NextResponse.json({ connected: false });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al cerrar sesión.",
      },
      { status: 500 }
    );
  }
}
