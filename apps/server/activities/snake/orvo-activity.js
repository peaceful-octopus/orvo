// Orvo activity SDK (host API version 1). Copy this file next to your activity's page.
//
//   import { connect } from './orvo-activity.js';
//   const orvo = await connect();
//   orvo.onMessage(({ from, data }) => { ... });
//   orvo.send({ hello: 'everyone' });          // to every other participant
//   orvo.send({ hello: 'you' }, somePeerId);   // for one participant (others ignore it)
//
// The page runs in a sandboxed iframe with no network access. All communication goes through the app.

const API_VERSION = 1;

/**
 * Waits for the app to introduce the call, then returns the activity's view of it.
 * @param {{ timeoutMs?: number }} [options]
 */
export function connect({ timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const messageHandlers = new Set();
    const participantHandlers = new Set();
    const closeHandlers = new Set();
    let api;

    const post = (message) => window.parent.postMessage({ orvo: API_VERSION, ...message }, '*');
    const timer = setTimeout(() => reject(new Error('The app did not start this activity.')), timeoutMs);

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (event.source !== window.parent || !msg || msg.orvo !== API_VERSION) return;

      if (msg.type === 'init') {
        clearTimeout(timer);
        for (const [name, value] of Object.entries(msg.theme ?? {})) document.documentElement.style.setProperty(name, value);
        api = {
          apiVersion: msg.apiVersion,
          instanceId: msg.instanceId,
          self: msg.self,
          host: msg.host,
          isHost: msg.isHost,
          /** Everyone who has this activity open, including you. Updated in place. */
          participants: [...msg.participants],
          theme: msg.theme,
          capabilities: msg.capabilities,
          send: (data, to) => post(to === undefined ? { type: 'send', data } : { type: 'send', to, data }),
          onMessage: (fn) => (messageHandlers.add(fn), () => messageHandlers.delete(fn)),
          onParticipants: (fn) => (participantHandlers.add(fn), () => participantHandlers.delete(fn)),
          onClose: (fn) => (closeHandlers.add(fn), () => closeHandlers.delete(fn)),
          /** Ends the activity for everyone. Only the host may. */
          end: () => post({ type: 'end' }),
        };
        resolve(api);
        return;
      }
      if (!api) return;
      if (msg.type === 'participant-joined') {
        if (!api.participants.some((p) => p.id === msg.participant.id)) api.participants.push(msg.participant);
        for (const fn of participantHandlers) fn(api.participants, { joined: msg.participant });
      } else if (msg.type === 'participant-left') {
        const index = api.participants.findIndex((p) => p.id === msg.id);
        if (index >= 0) api.participants.splice(index, 1);
        for (const fn of participantHandlers) fn(api.participants, { left: msg.id });
      } else if (msg.type === 'message') {
        for (const fn of messageHandlers) fn({ from: msg.from, data: msg.data });
      } else if (msg.type === 'close') {
        for (const fn of closeHandlers) fn();
      }
    });

    post({ type: 'ready' });
  });
}
