// Snake rules, with no DOM and no networking so they can be tested on their own.
// The host runs these and sends the resulting state to everyone.

/** @typedef {{ x: number, y: number }} Cell */
/** @typedef {{ id: string, body: Cell[], dir: string, alive: boolean, score: number, next?: string }} Snake */
/** @typedef {{ tick: number, phase: string, snakes: Snake[], food: Cell | null, winner: string | null, solo: boolean }} Game */

export const COLS = 32;
export const ROWS = 24;
export const MAX_PLAYERS = 8;
const START_LENGTH = 3;

/** @type {Record<string, Cell>} */
export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** @param {number} x @param {number} y */
const cell = (x, y) => y * COLS + x;
/** @param {Cell} a @param {Cell} b */
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
/** @param {string} a @param {string} b */
const opposite = (a, b) => DIRS[a].x + DIRS[b].x === 0 && DIRS[a].y + DIRS[b].y === 0;

/**
 * Starts a round for `playerIds`. Each snake gets its own row, alternating between the left and right edge.
 * @param {string[]} playerIds
 * @param {() => number} [rng]
 * @returns {Game}
 */
export function createGame(playerIds, rng = Math.random) {
  const ids = playerIds.slice(0, MAX_PLAYERS);
  const spacing = Math.floor((ROWS - 2) / ids.length);
  const snakes = ids.map((id, i) => {
    const y = 1 + i * spacing + Math.floor(spacing / 2);
    const fromLeft = i % 2 === 0;
    const headX = fromLeft ? START_LENGTH + 1 : COLS - START_LENGTH - 2;
    const body = Array.from({ length: START_LENGTH }, (_, k) => ({ x: headX + (fromLeft ? -k : k), y }));
    return { id, body, dir: fromLeft ? 'right' : 'left', alive: true, score: 0 };
  });
  /** @type {Game} */
  const game = { tick: 0, phase: 'playing', snakes, food: null, winner: null, solo: ids.length === 1 };
  game.food = pickFood(game, rng);
  return game;
}

/**
 * A random cell no snake occupies, or null when the board is full.
 * @param {Game} game
 * @param {() => number} [rng]
 * @returns {Cell | null}
 */
export function pickFood(game, rng = Math.random) {
  const taken = new Set(game.snakes.flatMap((s) => s.body.map((c) => cell(c.x, c.y))));
  const free = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!taken.has(cell(x, y))) free.push({ x, y });
  return free.length ? free[Math.floor(rng() * free.length)] : null;
}

/**
 * Changes a snake's direction for the next step. A turn straight back onto itself is ignored.
 * @param {Game} game
 * @param {string} id
 * @param {string} dir
 */
export function steer(game, id, dir) {
  const snake = game.snakes.find((s) => s.id === id);
  if (!snake || !snake.alive || !(dir in DIRS) || opposite(snake.dir, dir)) return;
  snake.next = dir;
}

/**
 * Removes a snake that left mid-round.
 * @param {Game} game
 * @param {string} id
 */
export function removePlayer(game, id) {
  const snake = game.snakes.find((s) => s.id === id);
  if (snake) {
    snake.alive = false;
    snake.body = [];
  }
  finishIfOver(game);
}

/**
 * Advances the round by one step.
 * @param {Game} game
 * @param {() => number} [rng]
 */
export function step(game, rng = Math.random) {
  if (game.phase !== 'playing') return game;
  game.tick++;

  const moving = game.snakes.filter((s) => s.alive);
  const next = new Map();
  for (const s of moving) {
    if (s.next) s.dir = s.next;
    s.next = undefined;
    const head = { x: s.body[0].x + DIRS[s.dir].x, y: s.body[0].y + DIRS[s.dir].y };
    const eats = game.food !== null && sameCell(head, game.food);
    // A tail that moves away frees its cell on this step, so following closely behind another snake is safe.
    next.set(s, { body: [head, ...(eats ? s.body : s.body.slice(0, -1))], eats });
  }

  const dead = new Set();
  for (const s of moving) {
    const head = next.get(s).body[0];
    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) {
      dead.add(s);
      continue;
    }
    for (const other of moving) {
      // Another snake's whole body counts, including its new head (so two heads meeting kill both); your own does not include your head.
      const cells = other === s ? next.get(other).body.slice(1) : next.get(other).body;
      if (cells.some((c) => sameCell(c, head))) {
        dead.add(s);
        break;
      }
    }
  }

  let ate = false;
  for (const s of moving) {
    if (dead.has(s)) {
      s.alive = false;
      s.body = [];
      continue;
    }
    const move = next.get(s);
    s.body = move.body;
    if (move.eats) {
      s.score++;
      ate = true;
    }
  }
  if (ate) game.food = pickFood(game, rng);

  finishIfOver(game);
  return game;
}

function finishIfOver(game) {
  const alive = game.snakes.filter((s) => s.alive);
  const over = game.solo ? alive.length === 0 : alive.length <= 1;
  if (!over && game.food !== null) return;
  game.phase = 'over';
  game.winner = !game.solo && alive.length === 1 ? alive[0].id : null;
}

/**
 * The state as sent to everyone: cells are packed as y * COLS + x so a long snake stays small.
 * @param {Game} game
 */
export function encode(game) {
  return {
    tick: game.tick,
    phase: game.phase,
    winner: game.winner,
    solo: game.solo,
    food: game.food ? cell(game.food.x, game.food.y) : null,
    snakes: game.snakes.map((s) => ({ id: s.id, alive: s.alive, score: s.score, dir: s.dir, body: s.body.map((c) => cell(c.x, c.y)) })),
  };
}

/** @param {number} n */
export const decodeCell = (n) => ({ x: n % COLS, y: Math.floor(n / COLS) });
