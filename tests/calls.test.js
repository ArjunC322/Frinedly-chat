import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { isLiveCall, callLabel } from '../src/call-state.js';

test('call labels, terminal states, and expiry', () => {
  const ringing = { caller_id: 'a', status: 'ringing', kind: 'video', expires_at: new Date(5000).toISOString() };
  assert.equal(isLiveCall(ringing, 4999), true);
  assert.equal(isLiveCall(ringing, 5000), false);
  assert.equal(isLiveCall({ ...ringing, status: 'ended' }, 1000), false);
  assert.equal(isLiveCall(null), false);
  assert.equal(callLabel(ringing, 'a', 'Bob'), 'Calling Bob...');
  assert.equal(callLabel(ringing, 'b', 'Alice'), 'Alice is video calling you');
  assert.equal(callLabel({ ...ringing, status: 'accepted' }, 'a', 'Bob'), 'Call with Bob');
});

test('call database enforces participant authorization, busy users and state transitions', async () => {
  const db = new PGlite();
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const c = '33333333-3333-4333-8333-333333333333';
  const asUser = async (id, role = 'authenticated') => {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  };
  const start = (peer, kind = 'audio') => db.query('select * from public.start_call($1, $2)', [peer, kind]);
  const respond = (id, action) => db.query('select * from public.respond_to_call($1, $2)', [id, action]);
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth, public to anon, authenticated;
      create table public.profiles(id uuid primary key);
      create publication supabase_realtime;
    `);
    await db.query('insert into public.profiles values ($1),($2),($3)', [a, b, c]);
    await db.exec(await readFile(new URL('../supabase/calls.sql', import.meta.url), 'utf8'));
    await asUser(a);
    await assert.rejects(start(a), /another friend/);
    await assert.rejects(start(b, 'invalid'), /check constraint/);
    const call = (await start(b, 'video')).rows[0];
    assert.equal(call.caller_id, a);
    assert.equal(call.status, 'ringing');
    await assert.rejects(start(c), /active call/);
    await assert.rejects(respond(call.id, 'accept'), /no longer be answered/);
    await assert.rejects(db.exec("update public.calls set status='accepted'"), /permission denied/);
    await assert.rejects(db.query('insert into public.calls(caller_id,callee_id,kind) values ($1,$2,$3)', [a,b,'audio']), /permission denied/);
    await asUser(c);
    assert.equal((await db.query('select * from public.calls')).rows.length, 0);
    await assert.rejects(start(b), /active call/);
    await assert.rejects(respond(call.id, 'accept'), /unavailable/);
    await assert.rejects(respond(call.id, 'end'), /unavailable/);
    await asUser(b);
    assert.equal((await db.query('select * from public.calls')).rows.length, 1);
    const accepted = (await respond(call.id, 'accept')).rows[0];
    assert.equal(accepted.status, 'accepted');
    assert.ok(new Date(accepted.expires_at) > new Date(call.expires_at));
    await assert.rejects(respond(call.id, 'decline'), /no longer be answered/);
    await assert.rejects(respond(call.id, 'garbage'), /Invalid call action/);
    await asUser(a);
    assert.equal((await respond(call.id, 'end')).rows[0].status, 'ended');
    const declined = (await start(b)).rows[0];
    await asUser(b);
    assert.equal((await respond(declined.id, 'decline')).rows[0].status, 'declined');
    await asUser(a);
    const expired = (await start(b)).rows[0];
    await db.exec('reset role');
    await db.query("update public.calls set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
    await asUser(b);
    await assert.rejects(respond(expired.id, 'accept'), /no longer be answered/);
    const next = (await start(a)).rows[0];
    assert.equal(next.caller_id, b);
    await asUser('', 'anon');
    await assert.rejects(start(a), /permission denied/);
    await assert.rejects(db.exec('select * from public.calls'), /permission denied/);
  } finally {
    await db.close();
  }
});
