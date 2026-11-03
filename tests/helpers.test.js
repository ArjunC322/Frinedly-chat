import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationError, initials, validateMessage } from '../src/helpers.js';

test('messages are trimmed; blank and over-limit text are rejected', () => {
  assert.equal(validateMessage('  Hello\nfriend!  '), 'Hello\nfriend!');
  assert.throws(() => validateMessage(' \n\t '), /Write a message/);
  assert.equal(validateMessage('a'.repeat(4000)).length, 4000);
  assert.throws(() => validateMessage('a'.repeat(4001)), /4000/);
  assert.equal(validateMessage('\u{1f600}'.repeat(4000)).length, 8000);
});

test('initials work for multiword, empty, and Unicode names', () => {
  assert.equal(initials('  Jane Doe  '), 'JD');
  assert.equal(initials('Alex'), 'A');
  assert.equal(initials(''), '?');
  assert.equal(initials('\u00c9mile Zola'), '\u00c9Z');
});

test('public settings reject missing, insecure, and privileged keys', () => {
  const url = 'https://test.supabase.co';
  const jwt = (role) => `header.${btoa(JSON.stringify({ role }))}.signature`;
  assert.ok(configurationError('', ''));
  assert.ok(configurationError('not-a-url', 'sb_publishable_test'));
  assert.ok(configurationError('http://test.supabase.co', 'sb_publishable_test'));
  assert.ok(configurationError(url, 'sb_secret_do_not_use'));
  assert.ok(configurationError(url, jwt('service_role')));
  assert.ok(configurationError(url, 'garbage'));
  assert.equal(configurationError(url, 'sb_publishable_test'), '');
  assert.equal(configurationError(url, jwt('anon')), '');
});
