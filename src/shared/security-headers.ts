// Browser security headers (kakeibo-app #267 流用・ブラッシュアップ)
// Worker 応答と静的配信 (_headers) の両方で同一のセキュリティヘッダーを付与する。

export function appContentSecurityPolicy(): string {
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    ['script-src', "'self'"],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['font-src', "'self'", 'data:'],
    ['img-src', "'self'", 'data:', 'blob:'],
    ['connect-src', "'self'"],
    ['manifest-src', "'self'"],
    ['worker-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  return directives.map((d) => d.join(' ')).join('; ');
}

export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

export const BASELINE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy':
    'accelerometer=(), camera=(self), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
};

export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  const headers = secured.headers;
  for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (!headers.has('content-security-policy')) {
    const isHtml = (headers.get('content-type') ?? '').toLowerCase().startsWith('text/html');
    headers.set('content-security-policy', isHtml ? appContentSecurityPolicy() : API_CONTENT_SECURITY_POLICY);
  }
  return secured;
}
