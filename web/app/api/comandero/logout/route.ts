// web/app/api/comandero/logout/route.ts
//
// POST → borra la cookie de empleado.

import { NextResponse } from "next/server";
import { clearEmployeeCookie } from "@/lib/employees/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearEmployeeCookie();
  return NextResponse.json({ ok: true });
}
