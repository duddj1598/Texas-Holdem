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
    const success = pokerRoom.addPlayer(socket.id, data.name || '알수없음');
    if (success) sendRoomUpdate();
  });

  socket.on('start_game', () => {
    const success = pokerRoom.forceStartGame(socket.id);
    if (success) sendRoomUpdate();
  });

  socket.on('player_action', (data: { actionType: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE'; amount: number }) => {
    const success = pokerRoom.handleAction(socket.id, data.actionType, data.amount);
    if (success) sendRoomUpdate();
  });

  socket.on('request_rebuy', () => {
    const success = pokerRoom.handleRebuy(socket.id);
    if (success) sendRoomUpdate();
  });

  socket.on('declare_out', () => {
    pokerRoom.declareOut(socket.id);
    sendRoomUpdate();
  });

  // 💡 [원인 해결]: 핸드 오픈을 서버가 받아서 브로드캐스팅하도록 이벤트 연결
  socket.on('expose_hand', () => {
    pokerRoom.handleExposeHand(socket.id);
  });

  // 💡 [신규 기능]: 래빗헌팅 요청 이벤트 연결
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
  console.log(`=========================================`);
  console.log(`🚀 WPL POKER 백엔드 서버 온라인: ${PORT}`);
  console.log(`=========================================`);
});