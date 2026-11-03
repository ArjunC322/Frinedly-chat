import { handleRequest } from './handler.ts';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('token endpoint verifies auth, participants, call state, expiry, and room grants', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
  const previous = keys.map((key) => Deno.env.get(key));
  const userId = '11111111-1111-4111-8111-111111111111';
  const callId = '22222222-2222-4222-8222-222222222222';
  const peerId = '33333333-3333-4333-8333-333333333333';
  let validAuth = true;
  let call: Record<string, unknown> | null = {
    id: callId, caller_id: userId, callee_id: peerId,
    status: 'accepted', expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  const values = ['https://test.supabase.co', 'public-test-key', 'wss://test.livekit.cloud', 'test-api-key', 'test-secret-with-at-least-thirty-two-characters'];
  keys.forEach((key, index) => Deno.env.set(key, values[index]));
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/auth/v1/user')) {
      return Response.json(validAuth ? { id: userId, aud: 'authenticated', role: 'authenticated' } : { message: 'Invalid token' }, { status: validAuth ? 200 : 401 });
    }
    if (url.includes('/rest/v1/calls')) return Response.json(call);
    throw new Error(`Unexpected request: ${url}`);
  };
  const request = (body: unknown = { callId }, auth = true) => new Request('https://function.test', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test-user-token' } : {}) },
    body: JSON.stringify(body),
  });
  try {
    assert((await handleRequest(new Request('https://function.test', { method: 'OPTIONS' }))).status === 200);
    assert((await handleRequest(new Request('https://function.test'))).status === 405);
    assert((await handleRequest(request({}, false))).status === 401);
    validAuth = false;
    assert((await handleRequest(request())).status === 401);
    validAuth = true;
    assert((await handleRequest(request({ callId: 'invalid' }))).status === 400);
    const allowed = await handleRequest(request());
    assert(allowed.status === 200);
    const body = await allowed.json();
    assert(body.url === values[2]);
    const payload = JSON.parse(atob(body.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    assert(payload.sub === userId);
    assert(payload.video.room === `call-${callId}`);
    assert(payload.video.roomJoin === true && payload.video.canPublishData === false);
    assert(!payload.video.roomAdmin && !payload.video.roomRecord);
    const remaining = payload.exp - Math.floor(Date.now() / 1000);
    assert(remaining > 0 && remaining <= 120);
    assert(!JSON.stringify(body).includes(values[4]), 'API secret leaked');
    const accepted = { ...call };
    call = { ...accepted, status: 'ringing' };
    assert((await handleRequest(request())).status === 403);
    call = { ...accepted, status: 'ended' };
    assert((await handleRequest(request())).status === 403);
    call = { ...accepted, expires_at: new Date(0).toISOString() };
    assert((await handleRequest(request())).status === 403);
    call = { ...accepted, caller_id: peerId, callee_id: peerId };
    assert((await handleRequest(request())).status === 403);
    call = null;
    assert((await handleRequest(request())).status === 403);
    Deno.env.delete('LIVEKIT_API_SECRET');
    assert((await handleRequest(request())).status === 503);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) Deno.env.delete(key);
      else Deno.env.set(key, previous[index]!);
    });
  }
});
