export function isLiveCall(call, now = Date.now()) {
  return Boolean(call && ['ringing', 'accepted'].includes(call.status) && Date.parse(call.expires_at) > now);
}

export function callLabel(call, userId, name) {
  if (call.status === 'accepted') return `Call with ${name}`;
  return call.caller_id === userId ? `Calling ${name}...` : `${name} is ${call.kind === 'video' ? 'video calling' : 'calling'} you`;
}
