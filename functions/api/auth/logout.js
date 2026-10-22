export async function onRequestPost() {
  const cookieHeader = 'a24_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
  return new Response(JSON.stringify({ success: true, message: 'Tizimdan chiqildi' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookieHeader
    }
  });
}
