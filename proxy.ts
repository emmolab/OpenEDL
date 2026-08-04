import { NextResponse } from "next/server";
import { SECURITY_HEADERS } from "./lib/security-headers";

export function proxy() {
  const response = NextResponse.next();
  for (const { key, value } of SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|og.png).*)"],
};
