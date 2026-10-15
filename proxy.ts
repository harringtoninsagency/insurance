import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Public by design: the login page, the realtor / mortgage broker opt-in page,
// the unsubscribe page + one-click endpoint (must work for anyone holding a
// signed link), the email provider's webhook (verified by signature), the
// public quote-request landing page, and the partner portal's own login and
// invite-acceptance pages (a partner has no session yet at either of those).
// The home page ("/") is also public (it's the portal picker) but is checked
// by exact match below, not listed here — a prefix match on "/" would make
// every path public.
const PUBLIC_PATHS = [
  "/login",
  "/partners",
  "/unsubscribe",
  "/api/unsubscribe",
  "/api/webhooks/resend",
  "/request-quote",
  "/partner/login",
  "/partner/signup",
  "/partner/accept-invite",
  "/auth/confirm",
  "/set-password",
  "/forgot-password",
];

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic =
    request.nextUrl.pathname === "/" ||
    PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    // The partner portal has its own login, separate from the internal one —
    // a partner account has no profiles row, so sending them to /login would
    // just be confusing (and pointless: they'd sign in fine, then bounce
    // straight back out of the internal dashboard, see app/(dash)/layout.tsx).
    loginUrl.pathname = request.nextUrl.pathname.startsWith("/partner") ? "/partner/login" : "/login";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // manifest.webmanifest (app/manifest.ts's auto-served route) and the
  // plain public/ static files it references (sw.js, icon-*.png) are PWA
  // installability assets — without this exclusion they fell through to
  // the same auth check as every real page and 307-redirected to /login
  // for anyone not already signed in, which silently broke the service
  // worker registration and made the manifest unreadable by a browser
  // checking installability before a visitor's first login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/cron|manifest.webmanifest|sw.js|icon-192.png|icon-512.png|icon-maskable-512.png).*)",
  ],
};
