import { webcrypto } from 'crypto';

export interface Card {
  suit: 'H' | 'D' | 'C' | 'S'; // Heart, Diamond, Clover, Spade
  value: number;               // 2~14 (14 = Ace)
}

export class Deck {
  private cards: Card[] = [];

  constructor() {
    const suits: Card['suit'][] = ['H', 'D', 'C', 'S'];
    for (const suit of suits) {
      for (let value = 2; value <= 14; value++) {
        this.cards.push({ suit, value });
      }
    }
    this.shuffle();
  }

  private shuffle() {
    // 암호학적 고난도 난수를 적용한 조작 불가 Fisher-Yates 알고리즘
    for (let i = this.cards.length - 1; i > 0; i--) {
      const array = new Uint32Array(1);
      webcrypto.getRandomValues(array);
      const j = array[0] % (i + 1);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  public deal(): Card {
    return this.cards.pop()!;
  }
}