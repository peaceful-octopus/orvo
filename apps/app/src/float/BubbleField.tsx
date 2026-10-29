import { motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Bubble } from '../Bubble';
import { COPY } from '../copy';
import { RemoveIcon } from './icons';
import { adaptiveMode, layout, splitForScreens, type LayoutMode } from './layouts';
import { ScreenTile } from './ScreenTile';
import { useSize } from './useSize';

export interface Member {
  id: string;
  name: string;
  stream?: MediaStream;
  video: boolean;
  audio: boolean;
  self?: boolean;
  unreachable?: boolean;
  route?: string;
}

export interface ScreenShare {
  id: string;
  name: string;
  stream?: MediaStream;
  self?: boolean;
}

/** Something shown in a tile of its own beside the bubbles, such as a running activity. */
export interface TileContent {
  id: string;
  node: ReactNode;
}

interface Props {
  members: Member[];
  mode: LayoutMode;
  /** Shared screens; they take most of the window and the bubbles move aside. */
  screens?: ScreenShare[];
  onStopSharing?: () => void;
  /** Other tiles, such as an activity; they share the screens' part of the window. */
  tiles?: TileContent[];
  /** Largest bubble diameter; omit for the default cap. */
  maxSize?: number;
  /** A row or column turns whichever way fits the window best; used by the floating window. */
  adaptive?: boolean;
  /** Owner only: puts a remove button on everyone else's bubble. */
  onKick?: (id: string, name: string) => void;
}

/** The glow reaches this much beyond the ring of bubbles, toward the edges of the window. */
const GLOW_SCALE = 1.4;

const spring = { type: 'spring', stiffness: 220, damping: 26 } as const;

/** Lays out circular bubbles in a row, column or ring, animating between arrangements. */
export function BubbleField({ members, mode, maxSize, screens = [], tiles = [], onStopSharing, adaptive, onKick }: Props) {
  const [ref, bounds] = useSize<HTMLDivElement>();
  const tileCount = screens.length + tiles.length;
  const split = splitForScreens(bounds, tileCount);
  // Beside a screen the bubbles line up in a column or row, whatever layout is chosen.
  const bubbleArea = { w: split.bubbles.w, h: split.bubbles.h };
  const direction = useRef<LayoutMode | undefined>(undefined);
  const bubbleMode = tileCount
    ? split.direction
    : adaptive
      ? adaptiveMode(mode, members.length, bubbleArea, direction.current, maxSize)
      : mode;
  direction.current = bubbleMode;
  const { size, positions } = layout(bubbleMode, members.length, bubbleArea, maxSize);

  // Around a ring of bubbles, a glow where the fire would be.
  const ringed = bubbleMode === 'campfire' && !tileCount && members.length > 1 && positions[0];
  const fire = ringed
    ? (() => {
        const cx = bubbleArea.w / 2;
        const cy = bubbleArea.h / 2;
        const from = positions[0]!;
        const radius = Math.hypot(from.x + size / 2 - cx, from.y + size / 2 - cy) + size * 0.3;
        return { x: cx - radius * GLOW_SCALE, y: cy - radius * GLOW_SCALE, d: radius * 2 * GLOW_SCALE };
      })()
    : undefined;

  // Whoever is here when the field first appears is simply there; people who arrive later pop in.
  const known = useRef<Set<string> | null>(null);
  const first = known.current === null;
  useEffect(() => {
    known.current = new Set(members.map((m) => m.id));
  });

  return (
    <div ref={ref} className="field">
      {fire && (
        <motion.div
          className="fire"
          aria-hidden="true"
          initial={false}
          animate={{ x: fire.x, y: fire.y, width: fire.d, height: fire.d }}
          transition={spring}
        >
          <i className="glow" />
        </motion.div>
      )}
      {members.map((m, i) => {
        const at = positions[i];
        if (!at) return null;
        const p = { x: at.x + split.bubbles.x, y: at.y + split.bubbles.y };
        return (
          <motion.div
            key={m.id}
            className="slot"
            initial={first || known.current?.has(m.id) ? false : { x: p.x, y: p.y, width: size, height: size, opacity: 0, scale: 0.6 }}
            animate={{ x: p.x, y: p.y, width: size, height: size, opacity: 1, scale: 1 }}
            transition={spring}
          >
            <Bubble
              name={m.name}
              stream={m.stream}
              videoOn={m.video}
              audioOn={m.audio}
              unreachable={m.unreachable}
              route={m.route}
              mirrored={m.self}
              muteAudio={m.self}
            />
            {onKick && !m.self && (
              <button className="kick" aria-label={COPY.room.kick.aria(m.name || 'Guest')} title={COPY.room.kick.aria(m.name || 'Guest')} onClick={() => onKick(m.id, m.name || 'Guest')}>
                <RemoveIcon />
              </button>
            )}
          </motion.div>
        );
      })}
      {screens.map((screen, i) => {
        const r = split.screens[i];
        if (!r) return null;
        const pad = 6;
        return (
          <motion.div
            key={screen.id}
            className="slot"
            initial={false}
            animate={{ x: r.x + pad, y: r.y + pad, width: Math.max(r.w - pad * 2, 0), height: Math.max(r.h - pad * 2, 0) }}
            transition={spring}
          >
            <ScreenTile name={screen.name} stream={screen.stream} self={screen.self} onStop={onStopSharing} />
          </motion.div>
        );
      })}
      {tiles.map((tile, i) => {
        const r = split.screens[screens.length + i];
        if (!r) return null;
        const pad = 6;
        return (
          <motion.div
            key={tile.id}
            className="slot"
            initial={false}
            animate={{ x: r.x + pad, y: r.y + pad, width: Math.max(r.w - pad * 2, 0), height: Math.max(r.h - pad * 2, 0) }}
            transition={spring}
          >
            {tile.node}
          </motion.div>
        );
      })}
    </div>
  );
}
