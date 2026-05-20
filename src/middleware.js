import { NextResponse } from "next/server";
import { verifyEdgeJwt } from "@/lib/auth/edgeJwt";

// Edge runtime — required by @opennextjs/cloudflare. verifyEdgeJwt and the
// login route's signer both pull their secret from jwtSecret.shared.js so
// cookies issued by Node-side login verify in this Edge-side proxy.

// Public routes that don't need auth
const PUBLIC_PATHS = [
  "/api/health",
  "/api/init",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/version",
  "/api/settings/require-login",
];

// Public prefixes (LLM API with own key auth)
const PUBLIC_PREFIXES = ["/v1", "/v1beta"];

function isPublicPath(pathname) {
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export default async function proxy(request) {
  const { pathname } = request.nextUrl;

  // 1. Public routes - always allow
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 2. Dashboard routes - check auth cookie
  if (pathname.startsWith("/dashboard")) {
    const token = request.cookies.get("auth_token")?.value;

    // On Cloudflare: REQUIRE_LOGIN from env vars
    // On Node.js: read from env or default to true
    const requireLogin = process.env.REQUIRE_LOGIN !== "false";

    if (!requireLogin) {
      return NextResponse.next();
    }

    if (token && (await verifyEdgeJwt(token))) {
      return NextResponse.next();
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  // 3. Root - redirect to dashboard
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // 4. API routes - allow through (auth handled in route handlers)
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // 5. Default - allow
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
