import { createClient } from '@supabase/supabase-js';
import { configurationError, validateMessage } from './helpers.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const setupError = configurationError(url, key);
export const supabase = setupError ? null : createClient(url, key);

export async function getFriends(userId) {
  const { data, error } = await supabase.from('profiles').select('id, display_name').order('display_name');
  if (error) throw error;
  return data.filter((profile) => profile.id !== userId);
}

export async function getMessages(userId, peerId, limit) {
  const { data, error } = await supabase.from('messages')
    .select('id, sender_id, recipient_id, body, created_at')
    .in('sender_id', [userId, peerId])
    .in('recipient_id', [userId, peerId])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (error) throw error;
  return { messages: data.slice(0, limit).reverse(), hasOlder: data.length > limit };
}

export async function sendMessage(userId, peerId, text) {
  const { data, error } = await supabase.from('messages').insert({
    sender_id: userId,
    recipient_id: peerId,
    body: validateMessage(text),
  }).select('id, sender_id, recipient_id, body, created_at').single();
  if (error) throw error;
  return data;
}
