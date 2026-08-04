export const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'none'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "img-src 'self' data: https:",
      "manifest-src 'self'",
      "media-src 'none'",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      "worker-src 'self' blob:",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
] as const;
