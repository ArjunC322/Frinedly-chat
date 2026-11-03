import { createClient } from 'npm:@supabase/supabase-js@2.80.0';
import { AccessToken } from 'npm:livekit-server-sdk@2.15.0';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const reply = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers });

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply(405, 'Use POST.');
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401, 'Sign in to make a call.');

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const livekitUrl = Deno.env.get('LIVEKIT_URL');
  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!url || !anonKey || !livekitUrl || !apiKey || !apiSecret) {
    console.error('Calling configuration is incomplete.');
    return reply(503, 'Calling is not configured. Ask the host to set the LiveKit function secrets.');
  }
  if (!/^wss:\/\/[^/]+\/?$/.test(livekitUrl)) {
    console.error('LIVEKIT_URL must be a secure WebSocket URL.');
    return reply(503, 'The host must configure a valid LiveKit wss:// URL.');
  }
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await client.auth.getUser(authorization.slice(7));
  if (authError || !auth.user) return reply(401, 'Your session expired. Sign in again.');

  let callId: unknown;
  try {
    ({ callId } = await request.json());
  } catch {
    return reply(400, 'Send a JSON callId.');
  }
  if (typeof callId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(callId)) {
    return reply(400, 'A valid callId is required.');
  }
  const { data: call, error } = await client.from('calls')
    .select('id, caller_id, callee_id, status, expires_at').eq('id', callId).maybeSingle();
  if (error) {
    console.error('Call lookup failed:', error.code);
    return reply(503, 'Could not verify the call. Check the calls database setup.');
  }
  if (!call || ![call.caller_id, call.callee_id].includes(auth.user.id) ||
      call.status !== 'accepted' || !(Date.parse(call.expires_at) > Date.now())) {
    return reply(403, 'Only participants in an accepted, unexpired call can join.');
  }
  try {
    const token = new AccessToken(apiKey, apiSecret, { identity: auth.user.id, ttl: '2m' });
    token.addGrant({
      roomJoin: true, room: `call-${call.id}`,
      canPublish: true, canSubscribe: true, canPublishData: false,
    });
    return new Response(JSON.stringify({ token: await token.toJwt(), url: livekitUrl }), { headers });
  } catch (error) {
    console.error('Call token generation failed:', error instanceof Error ? error.message : 'Unknown error');
    return reply(500, 'Could not create call access. Ask the host to check the LiveKit credentials.');
  }
}
