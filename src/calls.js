import { isLiveCall, callLabel } from './call-state.js';

const $ = (id) => document.getElementById(id);

export function createCalls(client, getPeer, getName) {
  let userId = null;
  let current = null;
  let room = null;
  let channel = null;
  let timer = null;
  let generation = 0;
  let syncing = false;
  let busy = false;
  let joining = false;
  let dismissedError = false;

  function report(error) {
    $('call-panel').hidden = false;
    $('call-error').hidden = false;
    $('call-error').textContent = error.message || String(error);
    $('dismiss-call').hidden = Boolean(current);
  }

  function clearError() {
    $('call-error').hidden = true;
    $('call-error').textContent = '';
  }

  function render() {
    $('audio-call').disabled = Boolean(current) || busy;
    $('video-call').disabled = Boolean(current) || busy;
    if (!current) return;
    $('call-panel').hidden = false;
    $('dismiss-call').hidden = true;
    const incoming = current.callee_id === userId && current.status === 'ringing';
    const otherId = current.caller_id === userId ? current.callee_id : current.caller_id;
    $('call-title').textContent = callLabel(current, userId, getName(otherId));
    $('call-status').textContent = current.status === 'ringing'
      ? 'Waiting for an answer. Invitations expire after 45 seconds.'
      : joining ? 'Connecting your microphone and camera...' : room?.state === 'connected'
        ? 'Connected. Your friend may still be joining.' : 'Connecting...';
    $('accept-call').hidden = !incoming;
    $('decline-call').hidden = !incoming;
    $('hangup-call').hidden = incoming;
    $('mute-call').hidden = !room || joining;
    $('camera-call').hidden = !room || joining || current.kind !== 'video';
    $('call-videos').hidden = current.kind !== 'video' || !room;
    for (const id of ['accept-call', 'decline-call', 'hangup-call', 'mute-call', 'camera-call']) {
      $(id).disabled = busy;
    }
  }

  function releaseMedia() {
    const previous = room;
    room = null;
    if (previous) void previous.disconnect();
    for (const id of ['local-video', 'remote-video', 'remote-audio']) {
      for (const media of $(id).querySelectorAll('video,audio')) media.srcObject = null;
      $(id).replaceChildren();
    }
    $('play-call-audio').hidden = true;
    $('mute-call').textContent = 'Mute microphone';
    $('mute-call').setAttribute('aria-pressed', 'false');
    $('camera-call').textContent = 'Turn camera off';
    $('camera-call').setAttribute('aria-pressed', 'false');
  }

  function clearCurrent(message) {
    generation++;
    joining = false;
    releaseMedia();
    current = null;
    $('call-title').textContent = 'Call finished';
    $('call-status').textContent = message;
    for (const id of ['accept-call', 'decline-call', 'hangup-call', 'mute-call', 'camera-call', 'call-videos']) $(id).hidden = true;
    $('dismiss-call').hidden = false;
    render();
  }

  async function rpc(action, id = current?.id) {
    const { data, error } = await client.rpc('respond_to_call', { call_id: id, action }).single();
    if (error) throw error;
    return data;
  }

  async function finish(message = 'You ended the call.') {
    const id = current?.id;
    if (!id) return;
    // Stop capturing immediately, even when the network cannot deliver hang-up.
    clearCurrent(message);
    try {
      await rpc('end', id);
    } catch (error) {
      report(`Your media stopped, but hang-up could not be delivered: ${error.message}. Your friend may need to hang up too.`);
    }
  }

  async function join() {
    if (!current || joining || room) return;
    joining = true;
    const version = generation;
    const call = current;
    render();
    try {
      const { data, error } = await client.functions.invoke('livekit-token', { body: { callId: call.id } });
      if (error) {
        let detail = error.message;
        if (error.context instanceof Response) {
          const text = await error.context.text();
          try { detail = JSON.parse(text).error || detail; } catch { detail = `${detail}: ${text.slice(0, 150)}`; }
        }
        throw new Error(`Could not get call access: ${detail}. Check the deployed livekit-token function and secrets.`);
      }
      if (!data?.token || !data?.url) throw new Error('The call server returned incomplete connection settings.');
      const { Room, RoomEvent, Track } = await import('livekit-client');
      if (version !== generation) return;
      const connectedRoom = new Room({ adaptiveStream: true, dynacast: true });
      room = connectedRoom;
      function attach(track, local = false) {
        if (version !== generation) return;
        const element = track.attach();
        element.autoplay = true;
        if (track.kind === Track.Kind.Video) {
          element.playsInline = true;
          element.muted = true;
          $(local ? 'local-video' : 'remote-video').append(element);
        } else {
          $('remote-audio').append(element);
        }
      }
      connectedRoom
        .on(RoomEvent.TrackSubscribed, (track) => attach(track))
        .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()))
        .on(RoomEvent.LocalTrackPublished, (publication) => {
          if (publication.track?.kind === Track.Kind.Video) attach(publication.track, true);
        })
        .on(RoomEvent.LocalTrackUnpublished, (publication) => publication.track?.detach().forEach((element) => element.remove()))
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (version === generation) $('play-call-audio').hidden = connectedRoom.canPlaybackAudio;
        })
        .on(RoomEvent.ParticipantConnected, () => {
          if (version === generation) $('call-status').textContent = 'Connected with your friend.';
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          if (version === generation) void finish('Your friend left the call.');
        })
        .on(RoomEvent.Reconnecting, () => {
          if (version === generation) $('call-status').textContent = 'Connection interrupted. Reconnecting...';
        })
        .on(RoomEvent.Reconnected, () => {
          if (version === generation) $('call-status').textContent = 'Reconnected.';
        })
        .on(RoomEvent.Disconnected, () => {
          if (version === generation) void finish('Call disconnected.');
        });
      await connectedRoom.connect(data.url, data.token);
      if (version !== generation) return void connectedRoom.disconnect();
      await connectedRoom.localParticipant.setMicrophoneEnabled(true);
      if (version !== generation) return void connectedRoom.disconnect();
      if (call.kind === 'video') await connectedRoom.localParticipant.setCameraEnabled(true);
      if (version !== generation) return void connectedRoom.disconnect();
      joining = false;
      $('play-call-audio').hidden = connectedRoom.canPlaybackAudio;
      render();
    } catch (error) {
      if (version !== generation) return;
      await finish('Call could not connect.');
      report(`Call failed: ${error.message}. Allow microphone/camera access, check your connection, and try again.`);
    }
  }

  async function sync() {
    if (!userId || syncing || busy) return;
    syncing = true;
    const id = userId;
    const version = generation;
    const snapshot = current;
    try {
      let query = client.from('calls').select('*');
      query = current ? query.eq('id', current.id) : query
        .in('status', ['ringing', 'accepted']).gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }).limit(1);
      const { data, error } = await query;
      if (error) throw error;
      if (id !== userId || version !== generation || current !== snapshot) return;
      if (current && !isLiveCall(data[0])) {
        clearCurrent(data[0]?.status === 'declined' ? 'Your friend declined the call.' : 'The call ended or timed out.');
      } else if (isLiveCall(data[0])) {
        current = data[0];
        clearError();
        render();
        if (current.status === 'accepted') void join();
      }
    } catch (error) {
      if (id === userId && version === generation && !dismissedError) {
        report(`Calling unavailable: ${error.message}. Run supabase/calls.sql and check your connection. Chat still works.`);
      }
    } finally {
      syncing = false;
    }
  }

  async function action(operation) {
    if (busy) return;
    busy = true;
    clearError();
    render();
    try { await operation(); } catch (error) { report(error); } finally { busy = false; render(); }
  }

  async function start(kind) {
    const peer = getPeer();
    if (!userId || !peer || current) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calling needs HTTPS and a browser with microphone/camera support.');
    const version = generation;
    const { data, error } = await client.rpc('start_call', { peer_id: peer.id, call_kind: kind }).single();
    if (error) throw error;
    if (version !== generation || !userId) {
      const { error: endError } = await client.rpc('respond_to_call', { call_id: data.id, action: 'end' });
      if (endError) report(`Could not cancel the invitation: ${endError.message}`);
      return;
    }
    current = data;
    render();
  }

  $('audio-call').addEventListener('click', () => void action(() => start('audio')));
  $('video-call').addEventListener('click', () => void action(() => start('video')));
  $('accept-call').addEventListener('click', () => void action(async () => {
    const version = generation;
    const call = await rpc('accept');
    if (version !== generation) return;
    current = call;
    void join();
  }));
  $('decline-call').addEventListener('click', () => void action(async () => {
    await rpc('decline');
    clearCurrent('You declined the call.');
  }));
  $('hangup-call').addEventListener('click', () => void action(() => finish()));
  $('mute-call').addEventListener('click', () => void action(async () => {
    if (!room) return;
    const participant = room.localParticipant;
    await participant.setMicrophoneEnabled(!participant.isMicrophoneEnabled);
    $('mute-call').textContent = participant.isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone';
    $('mute-call').setAttribute('aria-pressed', String(!participant.isMicrophoneEnabled));
  }));
  $('camera-call').addEventListener('click', () => void action(async () => {
    if (!room) return;
    const participant = room.localParticipant;
    await participant.setCameraEnabled(!participant.isCameraEnabled);
    $('camera-call').textContent = participant.isCameraEnabled ? 'Turn camera off' : 'Turn camera on';
    $('camera-call').setAttribute('aria-pressed', String(!participant.isCameraEnabled));
  }));
  $('play-call-audio').addEventListener('click', () => void action(async () => {
    if (room) await room.startAudio();
  }));
  $('dismiss-call').addEventListener('click', () => {
    dismissedError = true;
    $('call-panel').hidden = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync();
  });
  window.addEventListener('pagehide', () => {
    if (current) void finish('You left the page.');
    else {
      generation++;
      releaseMedia();
    }
  });

  return {
    start(id) {
      this.reset();
      userId = id;
      dismissedError = false;
      channel = client.channel(`calls-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `callee_id=eq.${id}` }, () => void sync())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `caller_id=eq.${id}` }, () => void sync())
        .subscribe();
      timer = setInterval(() => void sync(), 3000);
      void sync();
    },
    finish,
    reset() {
      generation++;
      userId = null;
      current = null;
      joining = false;
      clearInterval(timer);
      if (channel) void client.removeChannel(channel);
      channel = null;
      releaseMedia();
      clearError();
      $('call-panel').hidden = true;
      render();
    },
  };
}
