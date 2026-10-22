import { PeerServer } from 'peer';

const port = Number(process.env.PORT ?? 9000);

PeerServer({ port, path: '/chillcall', proxied: Boolean(process.env.BEHIND_PROXY) }, () => {
  console.log(`peerjs-server listening on :${port}/chillcall`);
});
