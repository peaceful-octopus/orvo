import { describe, expect, it } from 'vitest';
import { COLS, ROWS, createGame, decodeCell, encode, pickFood, removePlayer, steer, step } from '../activities/snake/sim.js';

const first = () => 0;

/** A one-player game with the snake and food placed exactly where a test needs them. */
function setup(body: { x: number; y: number }[], dir: string, food: { x: number; y: number } | null = { x: 0, y: 0 }) {
  const game = createGame(['a'], first);
  game.snakes[0]!.body = body;
  game.snakes[0]!.dir = dir;
  game.food = food;
  return game;
}

describe('createGame', () => {
  it('starts every snake alive in its own row, inside the board', () => {
    const game = createGame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], first);
    const rows = new Set(game.snakes.map((s) => s.body[0]!.y));
    expect(rows.size).toBe(8);
    for (const snake of game.snakes) {
      expect(snake.alive).toBe(true);
      for (const c of snake.body) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(COLS);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeLessThan(ROWS);
      }
    }
  });

  it('plays at most eight and puts food on a free cell', () => {
    const game = createGame(Array.from({ length: 12 }, (_, i) => `p${i}`), first);
    expect(game.snakes).toHaveLength(8);
    const food = game.food!;
    expect(game.snakes.some((s) => s.body.some((c) => c.x === food.x && c.y === food.y))).toBe(false);
  });
});

describe('step', () => {
  it('moves one cell in the facing direction', () => {
    const game = setup([{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    step(game, first);
    expect(game.snakes[0]!.body).toEqual([{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }]);
  });

  it('grows and scores when it eats, then places new food', () => {
    const game = setup([{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right', { x: 6, y: 5 });
    step(game, first);
    const snake = game.snakes[0]!;
    expect(snake.body).toHaveLength(4);
    expect(snake.score).toBe(1);
    expect(game.food).not.toEqual({ x: 6, y: 5 });
    expect(game.food).not.toBeNull();
  });

  it('ends a solo round at a wall', () => {
    const game = setup([{ x: COLS - 1, y: 5 }, { x: COLS - 2, y: 5 }, { x: COLS - 3, y: 5 }], 'right');
    step(game, first);
    expect(game.snakes[0]!.alive).toBe(false);
    expect(game.phase).toBe('over');
    expect(game.winner).toBeNull();
  });

  it('kills a snake that runs into itself', () => {
    const body = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 4 }];
    const game = setup(body, 'right');
    step(game, first);
    expect(game.snakes[0]!.alive).toBe(false);
  });

  it('lets a head enter the cell its own tail is leaving', () => {
    const body = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }];
    const game = setup(body, 'right');
    step(game, first);
    expect(game.snakes[0]!.alive).toBe(true);
  });

  it('ignores steering straight back, and applies a legal turn', () => {
    const game = setup([{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    steer(game, 'a', 'left');
    step(game, first);
    expect(game.snakes[0]!.body[0]).toEqual({ x: 6, y: 5 });
    steer(game, 'a', 'down');
    step(game, first);
    expect(game.snakes[0]!.body[0]).toEqual({ x: 6, y: 6 });
  });

  it('does not let two quick turns add up to a reversal', () => {
    const game = setup([{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    steer(game, 'a', 'up');
    steer(game, 'a', 'left');
    step(game, first);
    expect(game.snakes[0]!.body[0]).toEqual({ x: 5, y: 4 });
  });
});

describe('two players', () => {
  function duel() {
    const game = createGame(['a', 'b'], first);
    game.food = { x: 0, y: 0 };
    return game;
  }

  it('kills both when their heads meet', () => {
    const game = duel();
    game.snakes[0]!.body = [{ x: 10, y: 10 }, { x: 9, y: 10 }];
    game.snakes[0]!.dir = 'right';
    game.snakes[1]!.body = [{ x: 12, y: 10 }, { x: 13, y: 10 }];
    game.snakes[1]!.dir = 'left';
    step(game, first);
    expect(game.snakes.map((s) => s.alive)).toEqual([false, false]);
    expect(game.phase).toBe('over');
    expect(game.winner).toBeNull();
  });

  it('kills only the snake that hits the other one, and names the survivor', () => {
    const game = duel();
    game.snakes[0]!.body = [{ x: 10, y: 10 }, { x: 9, y: 10 }];
    game.snakes[0]!.dir = 'right';
    game.snakes[1]!.body = [{ x: 11, y: 9 }, { x: 11, y: 10 }, { x: 11, y: 11 }];
    game.snakes[1]!.dir = 'up';
    step(game, first);
    expect(game.snakes.map((s) => s.alive)).toEqual([false, true]);
    expect(game.phase).toBe('over');
    expect(game.winner).toBe('b');
  });

  it('keeps playing while two are alive', () => {
    const game = duel();
    step(game, first);
    expect(game.phase).toBe('playing');
  });

  it('ends the round with the other as winner when someone leaves', () => {
    const game = duel();
    removePlayer(game, 'a');
    expect(game.phase).toBe('over');
    expect(game.winner).toBe('b');
  });
});

describe('pickFood', () => {
  it('returns null when the board is full', () => {
    const game = createGame(['a'], first);
    game.snakes[0]!.body = Array.from({ length: COLS * ROWS }, (_, i) => ({ x: i % COLS, y: Math.floor(i / COLS) }));
    expect(pickFood(game, first)).toBeNull();
  });
});

describe('encode', () => {
  it('packs cells so a decoded state matches the game', () => {
    const game = createGame(['a', 'b'], first);
    const state = encode(game);
    expect(state.snakes[0]!.body.map(decodeCell)).toEqual(game.snakes[0]!.body);
    expect(decodeCell(state.food!)).toEqual(game.food);
    // The largest possible state stays well under the 8 KB message limit.
    const full = { ...state, snakes: [{ ...state.snakes[0]!, body: Array.from({ length: COLS * ROWS }, (_, i) => i) }] };
    expect(JSON.stringify({ t: 'state', s: full }).length).toBeLessThan(8 * 1024);
  });
});
