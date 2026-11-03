import './style.css';
import { getFriends, getMessages, sendMessage, setupError, supabase } from './api.js';
import { initials, validateMessage } from './helpers.js';
import { createCalls } from './calls.js';

const $ = (id) => document.getElementById(id);
let user = null;
let friends = [];
let peer = null;
let channel = null;
let pollTimer = null;
let messageLimit = 50;
let threadRequest = 0;
let sessionVersion = 0;
let renderedMessageIds = '';
let sending = false;
let realtimeStatus = '';
const drafts = new Map();
const calls = supabase ? createCalls(supabase, () => peer,
  (id) => friends.find((friend) => friend.id === id)?.display_name || 'Your friend') : null;

function showError(id, error) {
  $(id).textContent = error ? error.message || String(error) : '';
  $(id).hidden = !error;
}

function errorMessage(error) {
  if (error.message === 'Invalid login credentials') return 'That email or password did not match. Please try again.';
  return error.message || 'The request failed. Check your connection and try again.';
}

function renderFriends() {
  const search = $('friend-search').value.trim().toLowerCase();
  const visible = friends.filter((friend) => friend.display_name.toLowerCase().includes(search));
  $('friend-count').textContent = String(friends.length);
  $('friends').replaceChildren(...visible.map((friend, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `friend ${peer?.id === friend.id ? 'selected' : ''}`;
    button.setAttribute('aria-pressed', String(peer?.id === friend.id));
    const avatar = document.createElement('span');
    avatar.className = `avatar ${['peach', 'lavender', 'green'][index % 3]}`;
    avatar.textContent = initials(friend.display_name);
    const info = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = friend.display_name;
    const subtitle = document.createElement('small');
    subtitle.textContent = 'Say hello';
    info.append(name, subtitle);
    button.append(avatar, info);
    button.addEventListener('click', () => selectFriend(friend));
    return button;
  }));
  $('friends-status').textContent = visible.length ? '' : friends.length ? 'No friends match your search.' : 'No friends here yet. Ask your host to add accounts, then refresh.';
}

function renderMessages(messages, shouldScroll) {
  const signature = messages.map((message) => message.id).join(',');
  if (signature === renderedMessageIds) return;
  const container = $('messages');
  const previousHeight = container.scrollHeight;
  const previousTop = container.scrollTop;
  const nearBottom = previousHeight - previousTop - container.clientHeight < 100;
  const previousFirst = $('message-list').firstElementChild?.dataset.id;
  const previousOffset = $('message-list').firstElementChild?.offsetTop;
  $('message-list').replaceChildren(...messages.map((message) => {
    const article = document.createElement('article');
    article.className = `message ${message.sender_id === user.id ? 'mine' : 'theirs'}`;
    article.dataset.id = message.id;
    const body = document.createElement('p');
    body.textContent = message.body;
    const time = document.createElement('time');
    time.dateTime = message.created_at;
    time.textContent = new Date(message.created_at).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    article.append(body, time);
    return article;
  }));
  renderedMessageIds = signature;
  if (shouldScroll || nearBottom) {
    container.scrollTop = container.scrollHeight;
  } else {
    const anchor = [...$('message-list').children].find((item) => item.dataset.id === previousFirst);
    container.scrollTop = anchor ? previousTop + anchor.offsetTop - previousOffset : previousTop;
  }
}

async function refreshThread(scroll = false) {
  if (!user || !peer) return;
  const request = ++threadRequest;
  const userId = user.id;
  const peerId = peer.id;
  try {
    const result = await getMessages(userId, peerId, messageLimit);
    if (request !== threadRequest || user?.id !== userId || peer?.id !== peerId) return;
    showError('chat-error', null);
    $('thread-status').textContent = result.messages.length ? realtimeStatus : 'No messages yet. Be the first to say hello.';
    $('load-older').hidden = !result.hasOlder;
    renderMessages(result.messages, scroll);
  } catch (error) {
    if (request === threadRequest && user?.id === userId && peer?.id === peerId) {
      showError('chat-error', `Could not load messages: ${errorMessage(error)}`);
      $('thread-status').textContent = 'Waiting for messages. Retrying automatically.';
    }
  }
}

function selectFriend(friend) {
  if (peer) drafts.set(peer.id, $('message').value);
  peer = friend;
  messageLimit = 50;
  renderedMessageIds = '';
  threadRequest++;
  $('message-list').replaceChildren();
  $('load-older').hidden = true;
  $('thread-status').textContent = 'Loading conversation...';
  $('peer-name').textContent = friend.display_name;
  $('peer-avatar').textContent = initials(friend.display_name);
  $('message').value = drafts.get(friend.id) || '';
  $('empty-thread').hidden = true;
  $('active-thread').hidden = false;
  $('chat-view').classList.add('show-thread');
  renderFriends();
  void refreshThread(true);
}

function stopChat() {
  calls?.reset();
  clearInterval(pollTimer);
  pollTimer = null;
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
  threadRequest++;
  peer = null;
  friends = [];
  drafts.clear();
  $('friends').replaceChildren();
  $('message-list').replaceChildren();
  $('message').value = '';
  $('password').value = '';
  $('friend-search').value = '';
  $('active-thread').hidden = true;
  $('empty-thread').hidden = false;
  $('chat-view').classList.remove('show-thread');
  showError('chat-error', null);
}

async function applySession(session) {
  if (session?.user?.id === user?.id) return;
  const version = ++sessionVersion;
  stopChat();
  user = session?.user || null;
  $('login-view').hidden = Boolean(user);
  $('chat-view').hidden = !user;
  if (!user) return;
  $('friends-status').textContent = 'Loading your circle...';
  $('my-name').textContent = 'You';
  $('my-avatar').textContent = 'Y';
  try {
    const profiles = await getFriends(user.id);
    if (version !== sessionVersion) return;
    friends = profiles;
    const { data, error } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
    if (error) throw error;
    if (version !== sessionVersion) return;
    $('my-name').textContent = data.display_name;
    $('my-avatar').textContent = initials(data.display_name);
    renderFriends();
  } catch (error) {
    if (version === sessionVersion) {
      $('friends-status').textContent = 'Your circle could not be loaded.';
      showError('chat-error', `Could not load profiles: ${errorMessage(error)}. Check the database setup, then refresh.`);
    }
  }
  if (version !== sessionVersion) return;
  const userId = user.id;
  calls?.start(userId);
  channel = supabase.channel(`messages-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${userId}` }, () => void refreshThread())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${userId}` }, () => void refreshThread())
    .subscribe((status) => {
      if (version !== sessionVersion) return;
      realtimeStatus = status === 'SUBSCRIBED' ? '' : 'Live updates reconnecting. Checking for messages every 15 seconds.';
      if (status === 'SUBSCRIBED') void refreshThread();
      else if (peer) $('thread-status').textContent = realtimeStatus;
    });
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshThread();
  }, 15000);
}

$('toggle-password').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('toggle-password').textContent = show ? 'Hide password' : 'Show password';
  $('toggle-password').setAttribute('aria-pressed', String(show));
});

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) return showError('login-error', setupError);
  showError('login-error', null);
  $('login-button').disabled = true;
  $('login-button').textContent = 'Signing in...';
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: $('email').value.trim(), password: $('password').value,
    });
    if (error) throw error;
    $('password').value = '';
  } catch (error) {
    showError('login-error', errorMessage(error));
  } finally {
    $('login-button').disabled = false;
    $('login-button').textContent = 'Step inside \u2192';
  }
});

$('sign-out').addEventListener('click', async () => {
  $('sign-out').disabled = true;
  try {
    await calls?.finish('You signed out.');
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  } catch (error) {
    showError('chat-error', `Could not sign out: ${errorMessage(error)}`);
  } finally {
    $('sign-out').disabled = false;
  }
});

$('friend-search').addEventListener('input', renderFriends);
$('back-to-friends').addEventListener('click', () => $('chat-view').classList.remove('show-thread'));
$('load-older').addEventListener('click', async () => {
  messageLimit += 50;
  $('load-older').disabled = true;
  try {
    await refreshThread();
  } finally {
    $('load-older').disabled = false;
  }
});
$('message').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('message-form').requestSubmit();
  }
});
$('message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!user || !peer || sending) return;
  const currentUserId = user.id;
  const currentPeerId = peer.id;
  const draft = $('message').value;
  sending = true;
  $('send-button').disabled = true;
  showError('chat-error', null);
  try {
    await sendMessage(currentUserId, currentPeerId, validateMessage(draft));
    drafts.delete(currentPeerId);
    if (user?.id === currentUserId && peer?.id === currentPeerId) {
      if ($('message').value === draft) $('message').value = '';
      await refreshThread(true);
      $('message').focus();
    }
  } catch (error) {
    if (user?.id === currentUserId) {
      showError('chat-error', `Message not confirmed sent: ${errorMessage(error)}. Your draft is kept. If the connection dropped, check the conversation before retrying to avoid duplicates.`);
    }
  } finally {
    sending = false;
    $('send-button').disabled = false;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refreshThread();
});
window.addEventListener('offline', () => {
  if (user) showError('chat-error', 'You are offline. Messages will not send until your connection returns.');
});
window.addEventListener('online', () => void refreshThread());

if (setupError) {
  $('setup-notice').hidden = false;
  $('setup-notice').querySelector('p').textContent = `${setupError} Follow the included setup guide, then rebuild the website.`;
  $('login-button').disabled = true;
} else {
  // Supabase auth callbacks must return before making other Supabase requests.
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => void applySession(session), 0);
  });
  const { data, error } = await supabase.auth.getSession();
  if (error) showError('login-error', errorMessage(error));
  else await applySession(data.session);
}
