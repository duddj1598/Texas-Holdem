import { Deck, Card } from './Deck';

export interface Player {
  id: string;
  name: string;
  chips: number;
  buyInCount: number;
  isFolded: boolean;
  isAllIn: boolean;
  currentBet: number;
  cards: Card[];
  hasActed: boolean;
  isRebuyWaiting: boolean; 
}

export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
}

function evaluate7Cards(hole: Card[], community: Card[]): { rank: number; label: string; combo: Card[] } {
  const all = [...hole, ...community];
  if (all.length < 5) return { rank: 0, label: '하이카드', combo: all.slice(0, 5) };
  const sorted = [...all].sort((a, b) => b.value - a.value);

  const suits: any = { H: [], D: [], C: [], S: [] };
  sorted.forEach(c => { if (suits[c.suit]) suits[c.suit].push(c); });

  for (const suit in suits) {
    if (suits[suit].length >= 5) return { rank: 5, label: '플러시 🏆', combo: suits[suit].slice(0, 5) };
  }

  const groups: Record<number, Card[]> = {};
  sorted.forEach(c => {
    if (!groups[c.value]) groups[c.value] = [];
    groups[c.value].push(c);
  });

  const groupList = Object.values(groups).sort((a, b) => b.length - a.length || b[0].value - a[0].value);

  if (groupList[0].length === 4) {
    const kicker = sorted.find(c => c.value !== groupList[0][0].value)!;
    return { rank: 8, label: '포카드 🔥', combo: [...groupList[0], kicker] };
  }
  if (groupList[0].length === 3 && groupList[1] && groupList[1].length >= 2) {
    return { rank: 6, label: '풀하우스 🏠', combo: [...groupList[0], ...groupList[1].slice(0, 2)] };
  }
  if (groupList[0].length === 3) {
    const kickers = sorted.filter(c => c.value !== groupList[0][0].value).slice(0, 2);
    return { rank: 3, label: '트리플 셋', combo: [...groupList[0], ...kickers] };
  }
  if (groupList[0].length === 2 && groupList[1] && groupList[1].length === 2) {
    const mainPair = groupList[0];
    const subPair = groupList[1];
    const kicker = sorted.find(c => c.value !== mainPair[0].value && c.value !== subPair[0].value)!;
    return { rank: 2, label: '투페어', combo: [...mainPair, ...subPair, kicker] };
  }
  if (groupList[0].length === 2) {
    const kickers = sorted.filter(c => c.value !== groupList[0][0].value).slice(0, 3);
    return { rank: 1, label: '원페어', combo: [...groupList[0], ...kickers] };
  }
  return { rank: 0, label: '하이카드', combo: sorted.slice(0, 5) };
}

export class TournamentRoom {
  public id: string;
  public players: Player[] = [];
  public blindLevel: number = 1;
  public currentPot: number = 0;
  
  public communityCards: Card[] = [];
  public gameStage: 'WAITING' | 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN' = 'WAITING';
  
  public dealerIndex: number = 0;
  public currentTurnIndex: number = 0;
  public hostId: string = '';
  public highestBet: number = 0;
  public sidePots: SidePot[] = [];
  
  public roundWinnerId: string = ''; 
  public roundWinnerLabel: string = ''; 
  public winningCards: Card[] = []; 

  private blindTimer: NodeJS.Timeout | null = null;
  private actionTimer: NodeJS.Timeout | null = null;
  private io: any;
  private deck!: Deck;
  private timeLeft: number = 15;

  private blindStructure = [
    { sb: 100, bb: 200 }, { sb: 200, bb: 400 }, { sb: 300, bb: 600 }
  ];

  constructor(id: string, io: any) {
    this.id = id;
    this.io = io;
    this.startBlindTimer();
  }

  private startBlindTimer() {
    if (this.blindTimer) clearInterval(this.blindTimer);
    this.blindTimer = setInterval(() => {
      if (this.blindLevel < this.blindStructure.length) {
        this.blindLevel++;
        this.io.to(this.id).emit('blind_up', this.getBlindState());
      }
    }, 420000);
  }

  public getBlindState() {
    const idx = Math.min(this.blindLevel - 1, this.blindStructure.length - 1);
    return { level: this.blindLevel, ...this.blindStructure[idx] };
  }

  public addPlayer(id: string, name: string): boolean {
    if (this.players.length >= 9) return false;
    if (this.players.length === 0) this.hostId = id;
    const isMidGameJoin = this.gameStage !== 'WAITING';
    this.players.push({ id, name, chips: 20000, buyInCount: 1, isFolded: isMidGameJoin, isAllIn: false, currentBet: 0, cards: [], hasActed: isMidGameJoin, isRebuyWaiting: false });
    return true;
  }

  public removePlayer(id: string) {
    this.players = this.players.filter(p => p.id !== id);
    if (this.hostId === id && this.players.length > 0) this.hostId = this.players[0].id;
    if (this.players.length < 2) this.resetToLobby();
  }

  private resetToLobby() {
    this.gameStage = 'WAITING';
    this.communityCards = [];
    this.sidePots = [];
    this.roundWinnerId = '';
    this.roundWinnerLabel = '';
    this.winningCards = [];
    this.players.forEach(p => { p.cards = []; p.currentBet = 0; p.isFolded = false; p.isAllIn = false; p.hasActed = false; p.isRebuyWaiting = false; });
    if (this.actionTimer) clearInterval(this.actionTimer);
    this.io.to(this.id).emit('room_updated', this.getState());
  }

  public forceStartGame(requesterId: string): boolean {
    if (requesterId !== this.hostId || this.players.length < 2 || this.gameStage !== 'WAITING') return false;
    this.startNewHand();
    return true;
  }

  private startNewHand() {
    // 💡 [초기화 락 해제]: 다음 판 패를 셔플해 돌릴 때 비로소 이전 쇼다운 팟 메모리를 청소함
    this.sidePots = [];
    this.roundWinnerId = '';
    this.roundWinnerLabel = '';
    this.winningCards = []; 

    this.players.forEach(p => {
      if (!p.isRebuyWaiting && p.chips > 0) {
        p.isFolded = false;
        p.hasActed = false;
      }
    });

    const survivors = this.players.filter(p => !p.isRebuyWaiting && (p.chips > 0 || p.buyInCount < 3));
    
    if (survivors.length < 2) {
      const finalWinner = survivors[0] || this.players.find(p => p.chips > 0);
      this.io.to(this.id).emit('tournament_winner', { winner: finalWinner ? finalWinner.name : 'Unknown' });
      this.resetToLobby();
      return;
    }

    this.deck = new Deck();
    this.communityCards = [];
    this.currentPot = 0;
    this.highestBet = 0;
    this.gameStage = 'PREFLOP';
    
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    while (this.players[this.dealerIndex].isRebuyWaiting || this.players[this.dealerIndex].chips === 0) {
      this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    }

    const blind = this.getBlindState();
    
    let sbIndex = (this.dealerIndex + 1) % this.players.length;
    while (this.players[sbIndex].isRebuyWaiting || this.players[sbIndex].chips === 0) sbIndex = (sbIndex + 1) % this.players.length;

    let bbIndex = (sbIndex + 1) % this.players.length;
    while (this.players[bbIndex].isRebuyWaiting || this.players[bbIndex].chips === 0) bbIndex = (bbIndex + 1) % this.players.length;

    this.players.forEach((p, idx) => {
      if (!p.isRebuyWaiting && p.chips > 0) {
        p.isFolded = false;
        p.isAllIn = false;
        p.currentBet = 0;
        p.hasActed = false;
        p.cards = [this.deck.deal(), this.deck.deal()];
        
        if (idx === sbIndex) {
          const pay = Math.min(p.chips, blind.sb);
          p.chips -= pay;
          p.currentBet = pay;
          this.currentPot += pay;
          if (p.chips === 0) p.isAllIn = true;
        } else if (idx === bbIndex) {
          const pay = Math.min(p.chips, blind.bb);
          p.chips -= pay;
          p.currentBet = pay;
          this.currentPot += pay;
          if (p.chips === 0) p.isAllIn = true;
        }
      } else {
        p.isFolded = true;
        p.hasActed = true;
        p.cards = [];
      }
    });

    this.highestBet = blind.bb;
    this.currentTurnIndex = (bbIndex + 1) % this.players.length;
    while (this.players[this.currentTurnIndex].isFolded || this.players[this.currentTurnIndex].isRebuyWaiting) {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
    }
    
    this.startActionTimer();
    this.io.to(this.id).emit('room_updated', this.getState());
  }

  private startActionTimer() {
    if (this.actionTimer) clearInterval(this.actionTimer);
    this.timeLeft = 15;
    
    this.actionTimer = setInterval(() => {
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        clearInterval(this.actionTimer!);
        const currentPlayer = this.players[this.currentTurnIndex];
        if (currentPlayer) this.handleAction(currentPlayer.id, 'FOLD', 0);
      } else {
        this.io.to(this.id).emit('timer_tick', { timeLeft: this.timeLeft, currentTurnIndex: this.currentTurnIndex });
      }
    }, 1000);
  }

  public handleAction(playerId: string, actionType: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE', amount: number): boolean {
    const player = this.players[this.currentTurnIndex];
    if (!player || player.id !== playerId || this.gameStage === 'WAITING' || this.gameStage === 'SHOWDOWN') return false;

    player.hasActed = true;
    const totalAvailableChips = player.chips + player.currentBet;

    if (actionType === 'FOLD') {
      player.isFolded = true;
    } else if (actionType === 'CHECK') {
      if (player.currentBet < this.highestBet) return false;
    } else if (actionType === 'CALL') {
      const callCost = this.highestBet - player.currentBet;
      if (player.chips <= callCost) {
        this.currentPot += player.chips;
        player.currentBet += player.chips;
        player.chips = 0; 
        player.isAllIn = true;
      } else {
        player.chips -= callCost;
        player.currentBet += callCost;
        this.currentPot += callCost;
      }
    } else if (actionType === 'RAISE') {
      const minRaiseRequired = this.highestBet === 0 ? this.getBlindState().bb : this.highestBet * 2;
      
      if (totalAvailableChips < minRaiseRequired) {
        this.currentPot += player.chips;
        player.currentBet += player.chips;
        if (player.currentBet > this.highestBet) {
          this.highestBet = player.currentBet;
        }
        player.chips = 0; 
        player.isAllIn = true;
      } else {
        if (amount < minRaiseRequired) return false;
        const addedBetCost = amount - player.currentBet;
        player.chips -= addedBetCost;
        player.currentBet = amount;
        this.currentPot += addedBetCost;
        this.highestBet = amount;
      }
    }

    this.moveToNextTurn();
    return true;
  }

  private moveToNextTurn() {
    const foldedPlayers = this.players.filter(p => p.isFolded);

    if (foldedPlayers.length === this.players.length - 1) {
      const winner = this.players.find(p => !p.isFolded);
      this.roundWinnerId = winner?.id || '';
      this.roundWinnerLabel = '독점 기권승';
      this.winningCards = [];
      if (winner) winner.chips += this.currentPot;
      this.currentPot = 0;
      this.wrapUpHand();
      return;
    }

    const isRoundComplete = this.players
      .filter(p => !p.isFolded && !p.isRebuyWaiting && p.chips > 0)
      .every(p => (p.currentBet === this.highestBet || p.isAllIn) && p.hasActed);

    if (isRoundComplete) {
      this.calculateSidePots();
      this.nextStage();
      return;
    }

    let nextIndex = this.currentTurnIndex;
    let loopCount = 0;
    while (loopCount < this.players.length) {
      nextIndex = (nextIndex + 1) % this.players.length;
      const p = this.players[nextIndex];
      if (!p.isFolded && !p.isAllIn && !p.isRebuyWaiting) {
        this.currentTurnIndex = nextIndex;
        this.startActionTimer();
        this.io.to(this.id).emit('room_updated', this.getState());
        return;
      }
      loopCount++;
    }
    this.nextStage();
  }

  private calculateSidePots() {
    const activeBets = this.players.filter(p => !p.isFolded && p.currentBet > 0).map(p => p.currentBet);
    if (activeBets.length === 0) return;

    const uniqueBets = Array.from(new Set(activeBets)).sort((a, b) => a - b);
    this.sidePots = [];

    let lastLevel = 0;
    for (const betLevel of uniqueBets) {
      const currentLevelBet = betLevel - lastLevel;
      let potAmount = 0;
      const eligiblePlayers: string[] = [];

      this.players.forEach(p => {
        if (p.currentBet >= betLevel) {
          potAmount += currentLevelBet;
          if (!p.isFolded) eligiblePlayers.push(p.id);
        } else if (p.currentBet > lastLevel) {
          potAmount += (p.currentBet - lastLevel);
        }
      });

      if (potAmount > 0 && eligiblePlayers.length > 0) {
        this.sidePots.push({ amount: potAmount, eligiblePlayerIds: eligiblePlayers });
      }
      lastLevel = betLevel;
    }
  }

  private nextStage() {
    this.players.forEach(p => { if(!p.isFolded) p.currentBet = 0; p.hasActed = p.isFolded; });
    this.highestBet = 0;

    const nonAllInActive = this.players.filter(p => !p.isFolded && !p.isAllIn);
    
    if (nonAllInActive.length <= 1) {
      this.gameStage = 'SHOWDOWN';
      if (this.actionTimer) clearInterval(this.actionTimer);
      
      while (this.communityCards.length < 5) {
        const nextCard = this.deck.deal();
        if (nextCard) this.communityCards.push(nextCard);
      }
      this.determineShowdownWinner();
      return;
    }

    if (this.gameStage === 'PREFLOP') {
      this.gameStage = 'FLOP';
      this.communityCards = [this.deck.deal(), this.deck.deal(), this.deck.deal()];
    } else if (this.gameStage === 'FLOP') {
      this.gameStage = 'TURN';
      this.communityCards.push(this.deck.deal());
    } else if (this.gameStage === 'TURN') {
      this.gameStage = 'RIVER';
      this.communityCards.push(this.deck.deal());
    } else if (this.gameStage === 'RIVER') {
      this.determineShowdownWinner();
      return;
    }

    this.currentTurnIndex = (this.dealerIndex + 1) % this.players.length;
    while (this.players[this.currentTurnIndex].isFolded || this.players[this.currentTurnIndex].isAllIn) {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
    }

    this.startActionTimer();
    this.io.to(this.id).emit('room_updated', this.getState());
  }

  private determineShowdownWinner() {
    this.gameStage = 'SHOWDOWN';
    if (this.actionTimer) clearInterval(this.actionTimer);

    const contenders = this.players.filter(p => !p.isFolded);
    
    let bestScore = -1;
    let winningPlayer: Player | null = null;
    let winningLabel = '하이카드';
    let bestCombo: Card[] = [];

    contenders.forEach(p => {
      const evalResult = evaluate7Cards(p.cards, this.communityCards);
      if (evalResult.rank > bestScore) {
        bestScore = evalResult.rank;
        winningPlayer = p;
        winningLabel = evalResult.label;
        bestCombo = evalResult.combo; 
      }
    });

    if (winningPlayer) {
      (winningPlayer as Player).chips += this.currentPot;
      this.roundWinnerId = (winningPlayer as Player).id;
      this.roundWinnerLabel = winningLabel;
      this.winningCards = bestCombo; // 💡 족보 컴포넌트 5장 주입 완료
    }

    // 💡 [버그 대수술]: 쇼다운 화면 전송 직후 pot을 바로 0으로 비우지 않고 상태 유지 (클라이언트 지연 렌더링 동기화)
    this.wrapUpHand();
  }

  private wrapUpHand() {
    this.players.forEach(p => {
      if (p.chips === 0 && p.buyInCount < 3) {
        p.isRebuyWaiting = true;
      }
    });
    this.io.to(this.id).emit('room_updated', this.getState());

    setTimeout(() => {
      this.startNewHand();
    }, 7000); // 7초 감상 시간 유도 후 초기화
  }

  public handleRebuy(id: string): boolean {
    const player = this.players.find(p => p.id === id);
    if (player && player.isRebuyWaiting) {
      player.chips = 30000;
      player.buyInCount++;
      player.isRebuyWaiting = false; 
      return true;
    }
    return false;
  }

  public declareOut(id: string) {
    const player = this.players.find(p => p.id === id);
    if (player) {
      player.buyInCount = 3; 
      player.isRebuyWaiting = false;
      this.removePlayer(id);
    }
  }

  public getState() {
    return {
      id: this.id,
      blind: this.getBlindState(),
      pot: this.currentPot,
      gameStage: this.gameStage,
      communityCards: this.communityCards.filter(c => c && c.suit && c.value),
      dealerIndex: this.dealerIndex,
      currentTurnIndex: this.currentTurnIndex,
      hostId: this.hostId,
      highestBet: this.highestBet,
      timeLeft: this.timeLeft,
      sidePots: this.sidePots,
      roundWinnerId: this.roundWinnerId, 
      roundWinnerLabel: this.roundWinnerLabel, 
      winningCards: this.winningCards, 
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        buyInCount: p.buyInCount,
        isFolded: p.isFolded,
        isAllIn: p.isAllIn,
        currentBet: p.currentBet,
        cards: p.cards,
        isRebuyWaiting: p.isRebuyWaiting
      }))
    };
  }
}