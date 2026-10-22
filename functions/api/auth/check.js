export async function onRequestGet(context) {
  // If request made it past _middleware.js, the user is already authenticated
  return new Response(JSON.stringify({
    authenticated: true,
    user: context.data?.user || 'authorized'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
