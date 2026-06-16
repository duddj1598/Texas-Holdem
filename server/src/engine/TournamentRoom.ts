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
  sorted.forEach(c => {
    if (suits[c.suit]) suits[c.suit].push(c);
  });

  for (const suit in suits) {
    if (suits[suit].length >= 5) {
      return { rank: 5, label: '플러시 🏆', combo: suits[suit].slice(0, 5) };
    }
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

  // 💡 [로직 수정]: 특정 타겟 지정 없이, '누가' 핸드 공개 패킷들을 쐈는지 다중 추적하기 위해 배열 형태로 마이그레이션
  public exposedPlayerIds: string[] = []; 

  private blindTimer: NodeJS.Timeout | null = null;
  private actionTimer: NodeJS.Timeout | null = null;
  private io: any;
  private deck!: Deck;
  private timeLeft: number = 15;
  private isAnimatingBoard: boolean = false; 

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
      if (this.gameStage !== 'WAITING' && this.blindLevel < this.blindStructure.length) {
        this.blindLevel++;
        this.io.to(this.id).emit('blind_up', this.getBlindState());
        this.io.to(this.id).emit('room_updated', this.getState());
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

    this.players.push({ 
      id, 
      name, 
      chips: 20000, 
      buyInCount: 1, 
      isFolded: isMidGameJoin, 
      isAllIn: false, 
      currentBet: 0, 
      cards: [], 
      hasActed: isMidGameJoin, 
      isRebuyWaiting: false 
    });
    return true;
  }

  public removePlayer(id: string) {
    this.players = this.players.filter(p => p.id !== id);
    if (this.hostId === id && this.players.length > 0) this.hostId = this.players[0].id;
    
    if (this.players.length < 2) {
      this.resetToLobby();
    } else {
      this.io.to(this.id).emit('room_updated', this.getState());
    }
  }

  private resetToLobby() {
    this.gameStage = 'WAITING';
    this.blindLevel = 1; 
    this.communityCards = [];
    this.sidePots = [];
    this.roundWinnerId = '';
    this.roundWinnerLabel = '';
    this.winningCards = [];
    this.isAnimatingBoard = false;
    this.currentPot = 0;
    this.highestBet = 0;
    this.exposedPlayerIds = [];
    
    this.players.forEach(p => { 
      p.cards = []; 
      p.currentBet = 0; 
      p.isFolded = false; 
      p.isAllIn = false; 
      p.hasActed = false; 
      p.isRebuyWaiting = false; 
    });
    
    if (this.actionTimer) clearInterval(this.actionTimer);
    this.io.to(this.id).emit('room_updated', this.getState());
  }

  public forceStartGame(requesterId: string): boolean {
    if (requesterId !== this.hostId || this.players.length < 2 || this.gameStage !== 'WAITING') return false;
    this.startNewHand();
    return true;
  }

  private startNewHand() {
    this.sidePots = [];
    this.roundWinnerId = '';
    this.roundWinnerLabel = '';
    this.winningCards = []; 
    this.isAnimatingBoard = false;
    this.exposedPlayerIds = [];

    this.players.forEach(p => {
      if (!p.isRebuyWaiting && p.chips > 0) {
        p.isFolded = false;
        p.hasActed = false;
      }
    });

    const survivors = this.players.filter(p => !p.isRebuyWaiting && (p.chips > 0 || p.buyInCount < 3));
    
    if (survivors.length < 2) {
      const finalWinner = survivors[0] || this.players.find(p => p.chips > 0);
      
      const tournamentReport = this.players.map(p => ({
        name: p.name,
        finalChips: p.id === finalWinner?.id ? p.chips + this.currentPot : p.chips, 
        totalRebuys: p.buyInCount - 1 
      })).sort((a, b) => b.finalChips - a.finalChips);

      this.io.to(this.id).emit('tournament_winner', { 
        winner: finalWinner ? finalWinner.name : 'Unknown',
        report: tournamentReport
      });

      setTimeout(() => {
        this.resetToLobby();
      }, 500);
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
    if (this.isAnimatingBoard) return; 
    this.timeLeft = 15;
    
    this.actionTimer = setInterval(() => {
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        if (this.actionTimer) clearInterval(this.actionTimer);
        const currentPlayer = this.players[this.currentTurnIndex];
        if (currentPlayer) this.handleAction(currentPlayer.id, 'FOLD', 0);
      } else {
        this.io.to(this.id).emit('timer_tick', { timeLeft: this.timeLeft, currentTurnIndex: this.currentTurnIndex });
      }
    }, 1000);
  }

  public handleAction(playerId: string, actionType: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE', amount: number): boolean {
    if (this.isAnimatingBoard) return false; 
    
    const player = this.players[this.currentTurnIndex];
    if (!player || player.id !== playerId || this.gameStage === 'WAITING' || this.gameStage === 'SHOWDOWN') return false;

    if (player.isFolded) return false;

    if (this.actionTimer) {
      clearInterval(this.actionTimer);
      this.actionTimer = null;
    }

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
      
      if (amount >= totalAvailableChips || (amount - player.currentBet) >= player.chips) {
        const allInAmount = player.chips;
        player.currentBet += allInAmount;
        this.currentPot += allInAmount;
        player.chips = 0; 
        player.isAllIn = true;
        if (player.currentBet > this.highestBet) this.highestBet = player.currentBet;
      } else {
        if (amount < minRaiseRequired) return false;
        const addedBetCost = amount - player.currentBet;
        if (player.chips < addedBetCost) return false;

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
      this.roundWinnerLabel = '독점 기권승 🔥';
      this.winningCards = [];
      if (winner) winner.chips += this.currentPot;
      this.currentPot = 0;
      
      this.gameStage = 'SHOWDOWN'; 

      if (this.actionTimer) clearInterval(this.actionTimer);
      this.io.to(this.id).emit('room_updated', this.getState());

      setTimeout(() => {
        this.gameStage = 'PREFLOP'; 
        this.wrapUpHand();
      }, 7000);
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

  // 💡 [오픈 핵심 패치]: 폴드 여부 필터를 삭제하여 FOLD 유저도 전체 브로드캐스팅 가능하도록 개정
  public handleExposeHand(id: string): boolean {
    if (this.gameStage === 'SHOWDOWN' && !this.exposedPlayerIds.includes(id)) {
      this.exposedPlayerIds.push(id); 
      this.io.to(this.id).emit('room_updated', this.getState()); 
      return true;
    }
    return false;
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
    this.players.forEach(p => { 
      p.currentBet = 0; 
      p.hasActed = p.isFolded || p.isAllIn || p.isRebuyWaiting; 
    });
    this.highestBet = 0;

    const nonAllInActive = this.players.filter(p => !p.isFolded && !p.isAllIn);
    
    if (nonAllInActive.length <= 1) {
      this.runSequentialBoardReveal();
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

    let nextIndex = (this.dealerIndex + 1) % this.players.length;
    while (this.players[nextIndex].isFolded || this.players[nextIndex].isAllIn || this.players[nextIndex].isRebuyWaiting) {
      nextIndex = (nextIndex + 1) % this.players.length;
    }
    this.currentTurnIndex = nextIndex;

    this.startActionTimer();
    this.io.to(this.id).emit('room_updated', this.getState());
  }

  private runSequentialBoardReveal() {
    this.isAnimatingBoard = true;
    if (this.actionTimer) clearInterval(this.actionTimer);

    const intervalTime = 2200; 

    const revealStep = () => {
      if (this.gameStage === 'PREFLOP') {
        this.gameStage = 'FLOP';
        this.communityCards = [this.deck.deal(), this.deck.deal(), this.deck.deal()];
        this.io.to(this.id).emit('room_updated', this.getState());
        setTimeout(revealStep, intervalTime);
      } else if (this.gameStage === 'FLOP') {
        this.gameStage = 'TURN';
        this.communityCards.push(this.deck.deal());
        this.io.to(this.id).emit('room_updated', this.getState());
        setTimeout(revealStep, intervalTime);
      } else if (this.gameStage === 'TURN') {
        this.gameStage = 'RIVER';
        this.communityCards.push(this.deck.deal());
        this.io.to(this.id).emit('room_updated', this.getState());
        setTimeout(revealStep, intervalTime);
      } else if (this.gameStage === 'RIVER') {
        this.isAnimatingBoard = false;
        this.determineShowdownWinner();
      }
    };

    revealStep();
  }

  private determineShowdownWinner() {
    this.gameStage = 'SHOWDOWN';
    if (this.actionTimer) clearInterval(this.actionTimer);

    const contenders = this.players.filter(p => !p.isFolded);
    const evaluatedContenders = contenders.map(p => {
      const evalResult = evaluate7Cards(p.cards, this.communityCards);
      return {
        id: p.id,
        player: p,
        rank: evalResult.rank,
        label: evalResult.label,
        combo: evalResult.combo
      };
    });

    if (this.sidePots.length === 0 && this.currentPot > 0) {
      const eligibleIds = contenders.map(p => p.id);
      this.sidePots.push({ amount: this.currentPot, eligiblePlayerIds: eligibleIds });
    }

    let absoluteWinnerId = '';
    let absoluteWinnerLabel = '하이카드';
    let absoluteWinningCombo: Card[] = [];
    let absoluteMaxRank = -1;

    this.sidePots.forEach((pot) => {
      const potEligibleUnits = evaluatedContenders.filter(unit => pot.eligiblePlayerIds.includes(unit.id));
      
      if (potEligibleUnits.length > 0) {
        potEligibleUnits.sort((a, b) => b.rank - a.rank);
        const potWinner = potEligibleUnits[0];
        
        potWinner.player.chips += pot.amount;

        if (potWinner.rank > absoluteMaxRank) {
          absoluteMaxRank = potWinner.rank;
          absoluteWinnerId = potWinner.id;
          absoluteWinnerLabel = potWinner.label;
          absoluteWinningCombo = potWinner.combo;
        }
      }
    });

    this.roundWinnerId = absoluteWinnerId;
    this.roundWinnerLabel = absoluteWinnerLabel;
    this.winningCards = absoluteWinningCombo;

    this.currentPot = 0;
    this.io.to(this.id).emit('room_updated', this.getState());

    setTimeout(() => {
      this.gameStage = 'PREFLOP'; 
      this.wrapUpHand();
    }, 7000);
  }

  private wrapUpHand() {
    this.players.forEach(p => {
      if (p.chips === 0 && p.buyInCount < 3) {
        p.isRebuyWaiting = true;
      }
    });
    this.io.to(this.id).emit('room_updated', this.getState());

    const anyoneWaiting = this.players.some(p => p.isRebuyWaiting);
    if (!anyoneWaiting) {
      this.startNewHand();
    }
  }

  public handleRebuy(id: string): boolean {
    const player = this.players.find(p => p.id === id);
    if (player && player.isRebuyWaiting) {
      player.chips = 30000;
      player.buyInCount++;
      player.isRebuyWaiting = false; 
      
      const anyoneLeft = this.players.some(p => p.isRebuyWaiting);
      if (!anyoneLeft && this.gameStage === 'WAITING') { 
        this.startNewHand();
      } else {
        this.io.to(this.id).emit('room_updated', this.getState());
      }
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
      
      const anyoneLeft = this.players.some(p => p.isRebuyWaiting);
      if (!anyoneLeft && this.gameStage === 'SHOWDOWN') {
        this.startNewHand();
      } else {
        this.io.to(this.id).emit('room_updated', this.getState());
      }
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
      isAnimatingBoard: this.isAnimatingBoard, 
      exposedPlayerIds: this.exposedPlayerIds, 
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