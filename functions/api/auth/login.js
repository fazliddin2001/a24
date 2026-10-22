import { createSessionToken } from '../../utils/crypto.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { password } = body;

    const expectedPassword = env.APP_PASSWORD;
    if (!expectedPassword) {
      return new Response(JSON.stringify({ 
        error: 'Tizim xatoligi: Cloudflare boshqaruv panelida APP_PASSWORD o\'rnatilmagan (Missing APP_PASSWORD secret)' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const secret = env.SESSION_SECRET || expectedPassword;

    if (!password || password !== expectedPassword) {
      return new Response(JSON.stringify({ error: 'Parol noto\'g\'ri (Invalid password)' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = await createSessionToken('adchti_user', secret, 60 * 60 * 24 * 30); // 30 days

    const cookieHeader = `a24_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`;

    return new Response(JSON.stringify({ success: true, message: 'Xush kelibsiz!' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookieHeader
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server xatosi: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
