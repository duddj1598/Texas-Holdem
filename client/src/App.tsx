import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';

const SEAT_POSITIONS = [
  { top: '84%', left: '50%' }, 
  { top: '65%', left: '15%' }, 
  { top: '32%', left: '15%' }, 
  { top: '14%', left: '30%' }, 
  { top: '12%', left: '50%' }, 
  { top: '14%', left: '70%' }, 
  { top: '32%', left: '85%' }, 
  { top: '65%', left: '85%' }, 
];

const VALUE_LABELS: any = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

let socket: Socket;

export default function App() {
  const [joined, setJoined] = useState(false);
  const [name, setName] = useState('');
  const [gameState, setGameState] = useState<any>(null);
  const [showRebuy, setShowRebuy] = useState(false);
  const [winnerName, setWinnerName] = useState<string | null>(null); 
  const [tournamentReport, setTournamentReport] = useState<any[]>([]); 
  const [raiseValue, setRaiseValue] = useState<number>(0);
  const [showSlider, setShowSlider] = useState(false);
  const [globalTimer, setGlobalTimer] = useState<number>(15);

  // 개별 카드 로컬 오픈 상태 변수
  const [exposeLeft, setExposeLeft] = useState(false);
  const [exposeRight, setExposeRight] = useState(false);

  useEffect(() => {
    const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
    socket = io(SERVER_URL, {
      transports: ['websocket', 'polling']
    });
    
    socket.on('room_updated', (data) => {
      setGameState(data);
      setGlobalTimer(data.timeLeft);
      
      const me = data.players.find((p: any) => p.id === socket.id);
      if (me && me.isRebuyWaiting) {
        setShowRebuy(true);
      } else {
        setShowRebuy(false);
      }

      if (data.gameStage === 'PREFLOP' && data.timeLeft === 15) {
        setExposeLeft(false);
        setExposeRight(false);
      }
    });

    socket.on('timer_tick', (tick) => {
      setGlobalTimer(tick.timeLeft);
    });

    socket.on('tournament_winner', (data) => {
      setWinnerName(data.winner);
      setTournamentReport(data.report || []);
    });

    return () => { socket.disconnect(); };
  }, []);

  const handleAction = (type: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE', amt = 0) => {
    socket.emit('player_action', { actionType: type, amount: amt || raiseValue });
    setShowSlider(false);
  };

  const handleExposeHandToServer = () => {
    socket.emit('expose_hand');
    setExposeLeft(true);
    setExposeRight(true);
  };

  const handleDeclareOut = () => {
    socket.emit('declare_out');
    setShowRebuy(false);
  };

  const getOrderedPlayers = () => {
    if (!gameState || !gameState.players) return [];
    const players = [...gameState.players];
    const myIndex = players.findIndex((p: any) => p.id === socket.id);
    if (myIndex === -1) return players;
    return [...players.slice(myIndex), ...players.slice(0, myIndex)];
  };

  const checkCardInWinningCombo = (card: any) => {
    if (!gameState || !gameState.winningCards || !card) return false;
    const targetKey = `${String(card.suit)}${String(card.value)}`.trim().toUpperCase();
    return gameState.winningCards.some((wCard: any) => {
      if (!wCard) return false;
      const winningKey = `${String(wCard.suit)}${String(wCard.value)}`.trim().toUpperCase();
      return targetKey === winningKey;
    });
  };

  const getHandLabel = (player: any) => {
    if (!player || !player.cards || player.cards.length === 0) return '';
    if (player.isFolded) return '폴드';
    
    if (gameState?.gameStage === 'SHOWDOWN' && gameState?.roundWinnerId === player.id) {
      return gameState.roundWinnerLabel.replace('🏆', '').replace('🔥', '').replace('🏠', '').trim();
    }
    return '하이카드';
  };

  const renderCardComponent = (card: any, isHidden: boolean, indexOffset: number = 0) => {
    if (isHidden || !card || !card.suit || !card.value) {
      return (
        <div className="w-9 h-13 bg-gradient-to-b from-red-700 to-red-900 rounded-md border border-white/30 shadow-md flex items-center justify-center">
          <div className="w-5 h-9 border border-white/10 rounded bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:2px_2px] opacity-20" />
        </div>
      );
    }

    const suitSymbols: any = { H: '♥', D: '◆', C: '♣', S: '♠' };
    const suitColors: any = { H: 'text-red-500', D: 'text-sky-400', C: 'text-green-400', S: 'text-slate-900' }; 
    const displayValue = VALUE_LABELS[card.value] || card.value;

    const isShowdown = gameState?.gameStage === 'SHOWDOWN';
    const isPartOfWinningHand = checkCardInWinningCombo(card);

    const applyGrayscale = isShowdown && !isPartOfWinningHand;
    const applyHighlight = isShowdown && isPartOfWinningHand;

    return (
      <motion.div 
        className={`w-9 h-13 bg-white rounded-md flex flex-col justify-between p-1 text-black font-black text-[12px] border transition-all duration-300 ${
          applyHighlight 
            ? 'border-amber-400 ring-2 ring-amber-400 scale-110 shadow-[0_0_25px_#eab308] z-40' 
            : 'border-gray-300 shadow-lg'
        } ${applyGrayscale ? 'opacity-25 grayscale scale-90 contrast-75' : 'opacity-100'}`}
        style={{ transform: `rotate(${indexOffset === 0 ? '-4deg' : '4deg'})` }}
      >
        <div className={`leading-none text-left font-sans ${suitColors[card.suit]}`}>{displayValue}</div>
        <div className={`text-right text-base leading-none ${suitColors[card.suit]}`}>{suitSymbols[card.suit]}</div>
      </motion.div>
    );
  };

  if (!joined) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-[#121212] p-6 text-white">
        <div className="bg-[#1c1c1e] p-6 rounded-2xl border border-gray-800 w-full max-w-xs text-center shadow-2xl">
          <h1 className="text-md font-black text-yellow-500 tracking-widest mb-4 uppercase">WPL POKER</h1>
          <input type="text" placeholder="닉네임 입력" value={name} onChange={(e) => setName(e.target.value)} className="w-full p-3 bg-black rounded-xl text-center text-sm border border-gray-800 text-white focus:outline-none mb-4" />
          <button onClick={() => { if(name.trim()) { socket.emit('join_room', { name }); setJoined(true); } }} className="w-full bg-yellow-500 text-black font-bold py-3 rounded-xl text-sm shadow-lg">포커룸 입장</button>
        </div>
      </div>
    );
  }

  const orderedPlayers = getOrderedPlayers();
  const myData = gameState?.players.find((p: any) => p.id === socket.id);
  const currentTurnPlayer = gameState?.players[gameState?.currentTurnIndex];
  const isMyTurn = currentTurnPlayer?.id === socket.id && !gameState?.isAnimatingBoard && gameState?.gameStage !== 'SHOWDOWN';
  
  const currentHighest = gameState?.highestBet || 0;
  const myCurrentBet = myData?.currentBet || 0;
  const callCost = currentHighest - myCurrentBet;
  const isShowdown = gameState?.gameStage === 'SHOWDOWN';

  return (
    <div className="w-full h-screen bg-[#0c0d11] flex flex-col justify-between overflow-hidden text-white relative font-sans select-none">
      
      <div className="px-4 py-3 flex justify-between items-center bg-black/60 border-b border-white/5 z-10">
        <div className="text-xs text-gray-400">Blinds: <span className="text-white font-bold font-mono">{gameState?.blind?.sb || 0}/{gameState?.blind?.bb || 0}</span></div>
        <div className="text-xs bg-yellow-500/10 text-yellow-400 px-3 py-0.5 rounded-full border border-yellow-500/20 font-bold font-mono uppercase">{gameState?.gameStage}</div>
      </div>

      <div className="flex-1 w-full flex items-center justify-center p-4 relative">
        <div className="w-full max-w-[340px] aspect-[10/15.5] bg-gradient-to-b from-[#104782] to-[#071f3e] rounded-[90px] border-[8px] border-[#292b35] shadow-2xl relative flex flex-col items-center justify-center">
          
          <div className="absolute top-[21%] flex flex-col gap-0.5 items-center z-10">
            <div className="bg-black/60 px-4 py-1 rounded-full border border-yellow-500/20 text-center">
              <span className="text-[10px] text-yellow-500 font-bold block">Main Pot: {(gameState?.pot || 0).toLocaleString()}</span>
            </div>
            {gameState?.sidePots?.map((side: any, sIdx: number) => (
              <div key={sIdx} className="bg-black/80 px-2 py-0.5 rounded border border-cyan-500/30 text-[8px] text-cyan-400 font-mono scale-90">
                Side Pot {sIdx + 1}: {side.amount.toLocaleString()}
              </div>
            ))}
          </div>

          <div className="flex gap-1 justify-center max-w-[260px] absolute top-[44%] z-10">
            {gameState?.communityCards?.map((card: any, i: number) => (
              <motion.div key={i} initial={{ scale: 0 }} animate={{ scale: 1 }}>
                {renderCardComponent(card, false, 0)}
              </motion.div>
            ))}
            {gameState?.gameStage === 'SHOWDOWN' && gameState?.communityCards?.length < 5 && (
              <div className="w-9 h-13 bg-gray-600/30 rounded-md border border-white/10 flex items-center justify-center opacity-40 text-xs">🐰</div>
            )}
          </div>

          <AnimatePresence>
            {isShowdown && gameState?.roundWinnerLabel && (
              <motion.div 
                initial={{ opacity: 0, y: -10, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-[55%] w-full max-w-[260px] py-1.5 bg-gradient-to-r from-transparent via-black/80 to-transparent border-y border-yellow-500/10 text-center z-30 pointer-events-none"
              >
                <span className="text-yellow-400 font-black tracking-[0.35em] text-xl italic drop-shadow-[0_2px_8px_rgba(234,179,8,0.5)] pl-[0.35em]">
                  {gameState.roundWinnerLabel.replace('🏆', '').replace('🔥', '').replace('🏠', '').trim()}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {gameState?.gameStage === 'WAITING' && gameState?.hostId === socket.id && (
            <button onClick={() => socket.emit('start_game')} className="absolute bg-gradient-to-b from-yellow-400 to-yellow-600 text-black font-black text-xs px-6 py-3 rounded-xl shadow-2xl z-20">▶ GAME START</button>
          )}

          {orderedPlayers.map((player: any, idx: number) => {
            const originalIdx = gameState.players.findIndex((p: any) => p.id === player.id);
            const isTurn = gameState?.currentTurnIndex === originalIdx && gameState?.gameStage !== 'WAITING' && !gameState?.isAnimatingBoard && gameState?.gameStage !== 'SHOWDOWN';
            const isMe = player.id === socket.id;
            const isDealer = gameState?.dealerIndex === originalIdx;
            const isWinner = isShowdown && gameState?.roundWinnerId === player.id;

            const radius = 34;
            const circumference = 2 * Math.PI * radius;
            const strokeDashoffset = circumference - (globalTimer / 15) * circumference;

            // 💡 [오픈 권한 대개혁]: 서버 측 전파 리스트(`exposedPlayerIds`) 매핑 결합
            const isHandExposedByServer = gameState?.exposedPlayerIds?.includes(player.id);
            
            const showLeftCard = isShowdown ? (isWinner || isMe || isHandExposedByServer || (isMe && exposeLeft)) : isMe;
            const showRightCard = isShowdown ? (isWinner || isMe || isHandExposedByServer || (isMe && exposeRight)) : isMe;

            return (
              <div 
                key={player.id} 
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center z-20" 
                style={{ top: SEAT_POSITIONS[idx]?.top, left: SEAT_POSITIONS[idx]?.left }}
              >
                
                <div className="absolute bottom-[44%] mb-1 flex flex-col items-center justify-center pointer-events-none z-30 w-24">
                  {gameState?.gameStage !== 'WAITING' && !player.isRebuyWaiting && player.cards && player.cards.length > 0 && (
                    <>
                      <div className="relative w-full h-13 flex justify-center">
                        <div className="absolute left-1 z-10 shadow-md">
                          {renderCardComponent(player.cards[0], !showLeftCard, 0)}
                        </div>
                        <div className="absolute left-6 z-20 shadow-xl">
                          {renderCardComponent(player.cards[1], !showRightCard, 1)}
                        </div>
                      </div>
                      
                      {!player.isFolded && (
                        <div className="mt-1 bg-black/80 px-2 py-0.5 rounded text-[9px] text-yellow-400 font-bold tracking-wide shadow-md uppercase">
                          {getHandLabel(player)}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="relative w-18 h-18 rounded-full flex items-center justify-center shadow-xl mt-5">
                  {isTurn && (
                    <svg className="absolute w-20 h-20 transform -rotate-90 pointer-events-none z-10">
                      <circle cx="40" cy="40" r={radius} stroke="#f59e0b" strokeWidth="3" fill="transparent" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} className="transition-all duration-1000 ease-linear" />
                    </svg>
                  )}

                  <div className={`w-17 h-17 rounded-full flex flex-col items-center justify-center p-2 bg-[#14161e] border-2 transition-all duration-300 z-0 ${
                    isWinner ? 'border-yellow-400 ring-4 ring-yellow-400/50 shadow-[0_0_20px_#eab308]' : isTurn ? 'border-orange-500 ring-4 ring-orange-500/20' : 'border-gray-800'
                  }`}>
                    {player.currentBet > 0 && !isShowdown && (
                      <div className="absolute -bottom-5 bg-black/90 px-1.5 py-0.5 rounded border border-sky-400/30 text-[8px] font-mono text-sky-400 whitespace-nowrap z-20">🪙 {player.currentBet.toLocaleString()}</div>
                    )}

                    {isWinner && (
                      <div className="absolute -bottom-5 bg-gradient-to-r from-yellow-500 to-amber-500 text-black px-1.5 py-0.5 rounded font-black text-[8px] whitespace-nowrap z-20 shadow-md">
                        🏆 WINNER
                      </div>
                    )}

                    <div className="text-[9px] font-bold max-w-[56px] truncate text-gray-300">
                      {gameState.hostId === player.id ? `👑 ${player.name}` : player.name}
                    </div>
                    
                    <div className="text-[9px] font-mono font-bold text-green-400 mt-0.5">
                      {player.isRebuyWaiting ? (
                        <span className="text-orange-500 font-extrabold animate-pulse">REBUY?</span>
                      ) : player.isAllIn ? (
                        <span className="text-yellow-400 font-black">ALL-IN</span>
                      ) : (
                        player.chips.toLocaleString()
                      )}
                    </div>
                    
                    {player.isFolded && !player.isRebuyWaiting && player.cards?.length > 0 && <div className="absolute inset-0 bg-black/80 rounded-full flex items-center justify-center text-[9px] text-red-500 font-bold z-10">FOLD</div>}
                    {player.cards?.length === 0 && gameState?.gameStage !== 'WAITING' && <div className="absolute inset-0 bg-black/70 rounded-full flex items-center justify-center text-[8px] text-cyan-400 font-black z-10">OBSERVING</div>}
                    {player.isRebuyWaiting && <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center text-[8px] text-orange-400 font-black z-10">OUT_WAIT</div>}
                    {isDealer && <span className="absolute -bottom-1 -right-1 bg-white text-black font-black text-[8px] w-3.5 h-3.5 rounded-full flex items-center justify-center border border-gray-500 z-20">D</span>}
                  </div>
                </div>

              </div>
            );
          })}
        </div>

        {isMyTurn && showSlider && (
          <div className="absolute right-4 bg-black/95 p-3 rounded-2xl border border-gray-800 flex flex-col items-center gap-3 w-16 z-30 shadow-2xl">
            <span className="text-[9px] font-bold text-gray-400">RAISE</span>
            <input 
              type="range" 
              min={currentHighest === 0 ? (gameState?.blind?.bb || 200) : currentHighest * 2} 
              max={Number(myData?.chips || 0) + Number(myData?.currentBet || 0)} 
              value={raiseValue} 
              onChange={(e) => setRaiseValue(Number(e.target.value))} 
              className="h-24 accent-yellow-500" 
              style={{ writingMode: 'bt-lr' as any, appearance: 'slider-vertical' as any }} 
            />
            <span className="text-[9px] font-mono text-yellow-400 font-bold">{raiseValue.toLocaleString()}</span>
            
            <button onClick={() => setRaiseValue(Number(myData?.chips || 0) + Number(myData?.currentBet || 0))} className="bg-red-700/60 text-white text-[8px] font-bold py-0.5 w-full rounded border border-red-500/30 uppercase">MAX</button>
            <button onClick={() => {
              const maxChips = Number(myData?.chips || 0) + Number(myData?.currentBet || 0);
              handleAction('RAISE', raiseValue >= maxChips ? maxChips : raiseValue);
            }} className="bg-yellow-500 text-black text-[10px] font-black py-1 w-full rounded">확인</button>
          </div>
        )}
      </div>

      {/* 💡 [WPL 싱크 100% 매핑]: 하단 베팅 바 영역에 스크린샷 4단 분할 패널을 결합 */}
      <div className="w-full bg-[#14151a] p-4 border-t border-white/5 z-20 min-h-[80px] flex items-center justify-center">
        {gameState?.isAnimatingBoard ? (
          <div className="w-full py-4 bg-yellow-500/5 rounded-xl text-center text-xs text-yellow-500 border border-yellow-500/10 font-bold tracking-widest animate-pulse uppercase">
            🎬 ALL-IN SHOWDOWN: 보드 순차 오픈 연출 중...
          </div>
        ) : gameState?.gameStage === 'SHOWDOWN' ? (
          // 💡 [요구사항 반영]: 정산창 시작 시, 폴드한 사람을 포함해 관전 중이 아닌 카드 보유 유저 전원에게 4버튼 노출
          myData && myData.cards && myData.cards.length > 0 ? (
            <div className="w-full grid grid-cols-4 gap-1.5 bg-[#1c1d24] p-1.5 rounded-xl border border-white/5">
              <button 
                onClick={() => setExposeLeft(true)} 
                className={`py-3 rounded-lg text-xs font-black border transition-all flex flex-col items-center justify-center leading-tight ${
                  exposeLeft ? 'bg-black/40 text-gray-600 border-transparent' : 'bg-neutral-800 hover:bg-neutral-700 text-white border-white/5'
                }`}
              >
                <span className="text-[10px] opacity-60 block font-mono">1번 카드</span>
                <span className="text-yellow-400">{VALUE_LABELS[myData.cards[0]?.value] || myData.cards[0]?.value} 오픈</span>
              </button>
              
              <button 
                onClick={() => setExposeRight(true)} 
                className={`py-3 rounded-lg text-xs font-black border transition-all flex flex-col items-center justify-center leading-tight ${
                  exposeRight ? 'bg-black/40 text-gray-600 border-transparent' : 'bg-neutral-800 hover:bg-neutral-700 text-white border-white/5'
                }`}
              >
                <span className="text-[10px] opacity-60 block font-mono">2번 카드</span>
                <span className="text-yellow-400">{VALUE_LABELS[myData.cards[1]?.value] || myData.cards[1]?.value} 오픈</span>
              </button>
              
              <button 
                onClick={handleExposeHandToServer} 
                className="py-3 bg-gradient-to-b from-neutral-800 to-neutral-900 border border-white/10 hover:from-neutral-700 hover:to-neutral-800 text-yellow-500 rounded-lg text-xs font-black flex flex-col items-center justify-center leading-tight shadow-md"
              >
                <span className="text-[10px] opacity-60 block font-mono">전체</span>
                <span>오픈하기</span>
              </button>
              
              <button 
                className="py-3 bg-gradient-to-b from-neutral-700 to-neutral-800 text-gray-400 border border-white/5 rounded-lg text-xs font-black flex items-center justify-center uppercase font-mono tracking-wider cursor-not-allowed opacity-50"
                disabled
              >
                래빗헌팅
              </button>
            </div>
          ) : (
            <div className="w-full py-4 bg-emerald-500/5 rounded-xl text-center text-xs text-emerald-400 border border-emerald-500/10 font-bold tracking-widest animate-pulse uppercase">
              📊 SHOWDOWN: 경기 결과 및 족보 정산 확인 중...
            </div>
          )
        ) : isMyTurn && !myData?.isRebuyWaiting && myData?.cards?.length > 0 ? (
          callCost === 0 ? (
            <div className="w-full grid grid-cols-2 gap-2">
              <button onClick={() => handleAction('CHECK')} className="bg-gradient-to-b from-sky-600 to-sky-700 py-3.5 rounded-xl font-bold text-xs uppercase shadow-md border-t border-sky-400/20">체크</button>
              <button onClick={() => { setRaiseValue(currentHighest + (gameState?.blind?.bb || 200)); setShowSlider(!showSlider); }} className="bg-gradient-to-b from-amber-500 to-amber-600 text-black py-3.5 rounded-xl font-black text-xs uppercase shadow-md border-t border-amber-300/30">레이즈</button>
            </div>
          ) : (
            <div className="w-full grid grid-cols-3 gap-2">
              <button onClick={() => handleAction('FOLD')} className="bg-gradient-to-b from-gray-700 to-gray-800 py-3.5 rounded-xl font-bold text-xs uppercase shadow-md">폴드</button>
              <button onClick={() => handleAction('CALL')} className="bg-gradient-to-b from-emerald-600 to-emerald-700 py-3.5 rounded-xl font-bold text-xs uppercase shadow-md border-t border-emerald-400/20">콜 ({callCost.toLocaleString()})</button>
              <button onClick={() => { setRaiseValue(currentHighest + (gameState?.blind?.bb || 200)); setShowSlider(!showSlider); }} className="bg-gradient-to-b from-amber-500 to-amber-600 text-black py-3.5 rounded-xl font-black text-xs uppercase shadow-md border-t border-amber-300/30">레이즈</button>
            </div>
          )
        ) : (
          <div className="w-full py-4 bg-black/20 rounded-xl text-center text-xs text-gray-400 font-bold tracking-wide animate-pulse">
            {myData?.cards?.length === 0 && gameState?.gameStage !== 'WAITING' 
              ? '👀 다음 판 시작 시 참가합니다 (현재 판 관전 중)' 
              : myData?.isRebuyWaiting 
              ? '⚠️ 리바이인 결정을 완료해 주세요' 
              : '상대방의 턴 대기 중'}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showRebuy && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1c1c1e] border border-gray-800 rounded-2xl p-5 max-w-xs w-full text-center shadow-2xl">
              <h3 className="text-sm font-bold text-yellow-500 mb-1">💡 토너먼트 리바이인</h3>
              <p className="text-[11px] text-gray-400 mb-4">칩이 모두 소진되었습니다.<br />리바이인(30,000칩)을 충전하고 즉시 복귀하시겠습니까?</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleDeclareOut} className="bg-red-900/40 border border-red-500/30 text-red-400 py-2.5 rounded-xl text-xs font-bold">기권 (최종탈락)</button>
                <button onClick={() => { socket.emit('request_rebuy'); setShowRebuy(false); }} className="bg-green-600 py-2.5 rounded-xl text-xs font-bold text-white shadow-md">30K 충전 복귀</button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {winnerName && (
          <div className="fixed inset-0 bg-black/95 flex flex-col items-center justify-center p-4 z-50">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              className="bg-gradient-to-b from-[#1c1d24] to-[#0e1015] border-2 border-yellow-500 rounded-3xl p-6 w-full max-w-sm text-center shadow-[0_0_40px_rgba(234,179,8,0.3)]"
            >
              <div className="text-4xl mb-2">🏆</div>
              <h2 className="text-md font-black text-yellow-500 tracking-wider uppercase">Tournament Over</h2>
              <p className="text-sm font-bold text-gray-400 mt-1">최종 우승자: <span className="text-white font-extrabold">{winnerName}</span></p>

              <div className="mt-5 border border-white/5 rounded-xl overflow-hidden bg-black/40 text-left">
                <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-[10px] font-black tracking-wider text-gray-400 border-b border-white/5 uppercase">
                  <span className="col-span-2 text-center">순위</span>
                  <span className="col-span-4">닉네임</span>
                  <span className="col-span-4 text-right">최종 칩</span>
                  <span className="col-span-2 text-center">충전</span>
                </div>
                
                <div className="max-h-44 overflow-y-auto divide-y divide-white/5 font-mono">
                  {tournamentReport.map((row: any, rIdx: number) => (
                    <div key={rIdx} className={`grid grid-cols-12 px-3 py-2.5 text-[11px] items-center ${row.name === winnerName ? 'bg-yellow-500/5 text-yellow-400 font-bold' : 'text-gray-300'}`}>
                      <span className="col-span-2 text-center text-[10px] font-bold">
                        {rIdx === 0 ? '🥇' : rIdx === 1 ? '🥈' : rIdx === 2 ? '🥉' : `${rIdx + 1}위`}
                      </span>
                      <span className="col-span-4 truncate text-xs font-sans font-semibold">{row.name}</span>
                      <span className="col-span-4 text-right font-bold text-green-400">
                        {row.finalChips.toLocaleString()}
                      </span>
                      <span className="col-span-2 text-center font-bold text-orange-400">
                        {row.totalRebuys}회
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <button 
                onClick={() => window.location.reload()} 
                className="mt-6 w-full bg-gradient-to-r from-yellow-500 to-amber-500 text-black font-black text-xs py-3.5 rounded-xl shadow-lg active:scale-95 transition-all uppercase tracking-widest"
              >
                새 게임 로비로 이동
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}