import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { TournamentRoom } from './engine/TournamentRoom';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const rooms: Record<string, TournamentRoom> = {};
rooms['wpl-main-tournament'] = new TournamentRoom('wpl-main-tournament', io);

io.on('connection', (socket) => {
  socket.on('join_room', ({ name }) => {
    const room = rooms['wpl-main-tournament'];
    if (room.addPlayer(socket.id, name)) {
      socket.join(room.id);
      io.to(room.id).emit('room_updated', room.getState());
    }
  });

  socket.on('start_game', () => {
    const room = rooms['wpl-main-tournament'];
    if (room) room.forceStartGame(socket.id);
  });

  socket.on('player_action', ({ actionType, amount }) => {
    const room = rooms['wpl-main-tournament'];
    if (room) room.handleAction(socket.id, actionType, amount);
  });

  socket.on('request_rebuy', () => {
    const room = rooms['wpl-main-tournament'];
    if (room) {
      room.handleRebuy(socket.id);
      io.to(room.id).emit('room_updated', room.getState());
    }
  });

  socket.on('declare_out', () => {
    const room = rooms['wpl-main-tournament'];
    if (room) {
      room.declareOut(socket.id);
      io.to(room.id).emit('room_updated', room.getState());
    }
  });

  socket.on('disconnect', () => {
    const room = rooms['wpl-main-tournament'];
    if (room) {
      room.removePlayer(socket.id);
      io.to(room.id).emit('room_updated', room.getState());
    }
  });
});

httpServer.listen(4000, () => console.log('🚀 Operational on port 4000'));