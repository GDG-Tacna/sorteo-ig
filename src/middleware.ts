import { NextResponse, type NextRequest } from "next/server";
import { isLocalRequest } from "@/lib/local-only";

export const config = {
  matcher: "/api/ig/:path*",
};

export function middleware(request: NextRequest) {
  const allowed = isLocalRequest(
    request.headers.get("host"),
    request.headers.get("origin")
  );

  if (!allowed) {
    return NextResponse.json(
      { error: "Esta función solo está disponible al ejecutar la app en local." },
      { status: 403 }
    );
  }

  return NextResponse.next();
}
