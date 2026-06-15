import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { TournamentRoom } from './engine/TournamentRoom';

const app = express();

// 💡 [배포 필수 세팅]: 외부 도메인 접근 허용을 위한 CORS 마이그레이션
app.use(cors({
  origin: '*', // 전 세계 어디서든 접속 가능하도록 개방
  methods: ['GET', 'POST']
}));

const server = http.createServer(app);

// 💡 Socket.io CORS 정책 개방 및 웹소켓 핸드셰이크 활성화
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'] // Render 환경에서 안정적인 연결을 보장하기 위해 명시
});

// 단일 토너먼트 룸 인스턴스 생성 (대기방 ID: 'wpl-room')
const pokerRoom = new TournamentRoom('wpl-room', io);

io.on('connection', (socket) => {
  console.log(`🔌 유저 커넥션 생성 성공: [ID: ${socket.id}]`);

  // 방 상태 동기화 패킷 전송기
  const sendRoomUpdate = () => {
    io.to('wpl-room').emit('room_updated', pokerRoom.getState());
  };

  // 1. 유저 입장 이벤트
  socket.on('join_room', (data: { name: string }) => {
    socket.join('wpl-room');
    const success = pokerRoom.addPlayer(socket.id, data.name || '알수없음');
    
    if (success) {
      console.log(`📥 [JOIN] 플레이어 입장: ${data.name} (ID: ${socket.id})`);
      sendRoomUpdate();
    } else {
      socket.emit('error_message', { message: '방이 가득 찼거나 입장할 수 없습니다.' });
    }
  });

  // 2. 게임 수동 시작 (방장 호스트 전용 권한)
  socket.on('start_game', () => {
    const success = pokerRoom.forceStartGame(socket.id);
    if (success) {
      console.log(`▶️ [START] 호스트가 게임을 격발했습니다.`);
      sendRoomUpdate();
    }
  });

  // 3. 포커 베팅 액션 처리 (폴드, 체크, 콜, 레이즈)
  socket.on('player_action', (data: { actionType: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE'; amount: number }) => {
    const success = pokerRoom.handleAction(socket.id, data.actionType, data.amount);
    if (success) {
      sendRoomUpdate();
    }
  });

  // 4. 토너먼트 리바이인 충전 요청
  socket.on('request_rebuy', () => {
    const success = pokerRoom.handleRebuy(socket.id);
    if (success) {
      console.log(`🪙 [REBUY] 플레이어 복귀 성공 (ID: ${socket.id})`);
      sendRoomUpdate();
    }
  });

  // 5. 기권 선언 (최종 아웃 및 토너먼트 영구 이탈)
  socket.on('declare_out', () => {
    console.log(`❌ [DECLARE_OUT] 플레이어 기권 탈락 (ID: ${socket.id})`);
    pokerRoom.declareOut(socket.id);
    sendRoomUpdate();
  });

  // 6. 브라우저 종료 및 연결 해제 (Disconnect)
  socket.on('disconnect', () => {
    console.log(`🔌 유저 커넥션 해제: [ID: ${socket.id}]`);
    pokerRoom.removePlayer(socket.id);
    sendRoomUpdate();
  });
});

// 💡 [배포 실패 원인 차단 핵심]: Render가 할당해 준 10000번 포트를 최우선으로 매핑 (로컬은 4000)
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 WPL POKER 백엔드 서버 엔진 온라인 구동 완료`);
  console.log(`🎯 배포 가동 바인딩 포트: ${PORT}`);
  console.log(`=========================================`);
});