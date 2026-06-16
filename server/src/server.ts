import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { TournamentRoom } from './engine/TournamentRoom';

const app = express();

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST']
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

const pokerRoom = new TournamentRoom('wpl-room', io);

io.on('connection', (socket) => {
  console.log(`🔌 유저 커넥션 생성: [ID: ${socket.id}]`);

  const sendRoomUpdate = () => {
    io.to('wpl-room').emit('room_updated', pokerRoom.getState());
  };

  socket.on('join_room', (data: { name: string }) => {
    socket.join('wpl-room');
    if (pokerRoom.addPlayer(socket.id, data.name || '알수없음')) sendRoomUpdate();
  });

  socket.on('start_game', () => {
    if (pokerRoom.forceStartGame(socket.id)) sendRoomUpdate();
  });

  socket.on('player_action', (data: { actionType: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE'; amount: number }) => {
    if (pokerRoom.handleAction(socket.id, data.actionType, data.amount)) sendRoomUpdate();
  });

  socket.on('request_rebuy', () => {
    if (pokerRoom.handleRebuy(socket.id)) sendRoomUpdate();
  });

  socket.on('declare_out', () => {
    pokerRoom.declareOut(socket.id);
    sendRoomUpdate();
  });

  // 💡 [핵심 버그 수정]: 좌/우 개별 카드 오픈 신호를 수신하여 브로드캐스팅
  socket.on('expose_hand', (data?: { target: 'left' | 'right' | 'all' }) => {
    pokerRoom.handleExposeHand(socket.id, data?.target || 'all');
  });

  // 💡 [핵심 버그 수정]: 래빗헌팅(보드 확인) 신호 수신
  socket.on('request_rabbit_hunt', () => {
    pokerRoom.handleRabbitHunt();
  });

  socket.on('disconnect', () => {
    pokerRoom.removePlayer(socket.id);
    sendRoomUpdate();
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 WPL POKER 백엔드 서버 온라인: ${PORT}`);
});