import { PEER_PATH, isValidRoomSlug } from '@chillcall/rtc/shared';
import express from 'express';
import http from 'node:http';
import { ExpressPeerServer } from 'peer';
import { RoomRegistry } from './rooms';

const port = Number(process.env.PORT ?? 9000);
const rooms = new RoomRegistry();

const app = express();
const server = http.createServer(app);
const peerServer = ExpressPeerServer(server, { path: '/', proxied: Boolean(process.env.BEHIND_PROXY) });

peerServer.on('connection', (client) => {
  if (!rooms.add(client.getId())) client.getSocket()?.close();
});
peerServer.on('disconnect', (client) => rooms.remove(client.getId()));

app.get('/rooms/:room', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const { room } = req.params;
  if (!isValidRoomSlug(room)) {
    res.status(400).json({ error: 'invalid room' });
    return;
  }
  res.json(rooms.info(room));
});
app.use(PEER_PATH, peerServer);

server.listen(port, () => console.log(`signaling listening on :${port}`));
