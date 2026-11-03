import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('database enforces private conversations and admin-managed profiles', async () => {
  const db = new PGlite();
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const charlie = '33333333-3333-4333-8333-333333333333';
  async function asUser(id, role = 'authenticated') {
    await db.exec(`reset role; set role ${role};`);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  }
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      create publication supabase_realtime;
    `);
    await db.query('insert into auth.users (id, raw_user_meta_data) values ($1, $2)', [alice, '{"display_name":"Alice"}']);
    await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
    await db.query('insert into auth.users (id, raw_user_meta_data) values ($1, $2), ($3, $4)', [bob, '{"display_name":"Bob"}', charlie, '{}']);
    assert.equal((await db.query('select * from public.profiles')).rows.length, 3);

    await asUser(alice);
    assert.equal((await db.query('select * from public.profiles')).rows.length, 3);
    await db.query('insert into public.messages (recipient_id, body) values ($1, $2)', [bob, 'Hello Bob']);
    await assert.rejects(db.query('insert into public.messages (sender_id, recipient_id, body) values ($1, $2, $3)', [bob, charlie, 'Impersonation']), /row-level security/);
    await assert.rejects(db.query('insert into public.messages (recipient_id, body) values ($1, $2)', [alice, 'Self message']), /different_participants/);
    for (const body of ['', ' \n\t ', 'a'.repeat(4001)]) {
      await assert.rejects(db.query('insert into public.messages (recipient_id, body) values ($1, $2)', [bob, body]), /check constraint/);
    }
    await db.query('insert into public.messages (recipient_id, body) values ($1, $2)', [bob, 'a'.repeat(4000)]);
    await assert.rejects(db.query("insert into public.messages (recipient_id, body, created_at) values ($1, 'fake date', now())", [bob]), /permission denied/);
    await assert.rejects(db.exec("update public.profiles set display_name = 'Intruder'"), /permission denied/);
    await assert.rejects(db.exec("update public.messages set body = 'Edited'"), /permission denied/);
    await assert.rejects(db.exec('delete from public.messages'), /permission denied/);

    await asUser(bob);
    assert.equal((await db.query('select * from public.messages')).rows.length, 2);
    await db.query('insert into public.messages (recipient_id, body) values ($1, $2)', [charlie, 'Hi Charlie']);
    await asUser(charlie);
    const charlieMessages = (await db.query('select * from public.messages')).rows;
    assert.equal(charlieMessages.length, 1);
    assert.equal(charlieMessages[0].body, 'Hi Charlie');
    await asUser(alice);
    assert.equal((await db.query('select * from public.messages')).rows.length, 2);
    await asUser('', 'anon');
    await assert.rejects(db.exec('select * from public.messages'), /permission denied/);
    await assert.rejects(db.exec('select * from public.profiles'), /permission denied/);
    await assert.rejects(db.query('insert into public.messages (recipient_id, body) values ($1, $2)', [bob, 'Anonymous']), /permission denied/);
  } finally {
    await db.close();
  }
});
