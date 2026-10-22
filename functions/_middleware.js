import { verifySessionToken, parseCookies } from './utils/crypto.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Allow static assets and frontend pages freely
  if (!url.pathname.startsWith('/api/')) {
    return context.next();
  }

  // Public API endpoints that do not require prior authentication
  if (url.pathname === '/api/auth/login') {
    return context.next();
  }

  const secret = env.SESSION_SECRET || env.APP_PASSWORD;
  if (!secret) {
    return new Response(JSON.stringify({ 
      error: 'Tizim xatoligi: SESSION_SECRET yoki APP_PASSWORD o\'rnatilmagan' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 1. Check Cookie header
  const cookies = parseCookies(request.headers.get('Cookie'));
  let token = cookies['a24_session'];

  // 2. Check Authorization Bearer header fallback
  if (!token) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
  }

  const session = await verifySessionToken(token, secret);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Avtorizatsiyadan o\'tilmagan (Unauthorized)' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  }

  // Pass verified user data to downstream handler
  context.data = context.data || {};
  context.data.user = session.u;

  return context.next();
}
