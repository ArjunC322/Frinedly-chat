export const MAX_MESSAGE_LENGTH = 4000;

export function validateMessage(value) {
  const body = value.trim();
  if (!body) throw new Error('Write a message before sending.');
  if ([...body].length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Keep your message within ${MAX_MESSAGE_LENGTH} characters.`);
  }
  return body;
}

export function initials(name) {
  return name.trim().split(/\s+/u).slice(0, 2).map((part) => [...part][0]).join('').toUpperCase() || '?';
}

export function configurationError(url, key) {
  if (!url || !key || url.includes('YOUR_PROJECT') || key.includes('YOUR_')) {
    return 'Add your Supabase URL and public publishable key to enable sign-in.';
  }
  try {
    if (new URL(url).protocol !== 'https:') return 'The Supabase URL must use HTTPS.';
  } catch {
    return 'The Supabase URL is not a valid URL.';
  }
  if (key.startsWith('sb_secret_')) return 'Do not use a secret key in this website. Use a publishable key.';
  if (!key.startsWith('sb_publishable_')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role !== 'anon') return 'Use the public anon key, never a service-role key.';
    } catch {
      return 'Use a Supabase publishable key or legacy public anon key.';
    }
  }
  return '';
}
