import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { Bubble } from '../Bubble';
import { layout, splitForScreens, type LayoutMode } from './layouts';
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

interface Props {
  members: Member[];
  mode: LayoutMode;
  /** Shared screens; they take most of the window and the bubbles move aside. */
  screens?: ScreenShare[];
  onStopSharing?: () => void;
  /** Largest bubble diameter; omit for the default cap. */
  maxSize?: number;
}

const spring = { type: 'spring', stiffness: 220, damping: 26 } as const;

/** Lays out circular bubbles in a row, column or ring, animating between arrangements. */
export function BubbleField({ members, mode, maxSize, screens = [], onStopSharing }: Props) {
  const [ref, bounds] = useSize<HTMLDivElement>();
  const split = splitForScreens(bounds, screens.length);
  // Beside a screen the bubbles line up in a column or row, whatever layout is chosen.
  const bubbleMode = screens.length ? split.direction : mode;
  const { size, positions } = layout(bubbleMode, members.length, { w: split.bubbles.w, h: split.bubbles.h }, maxSize);

  // Whoever is here when the field first appears is simply there; people who arrive later pop in.
  const known = useRef<Set<string> | null>(null);
  const first = known.current === null;
  useEffect(() => {
    known.current = new Set(members.map((m) => m.id));
  });

  return (
    <div ref={ref} className="field">
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
    </div>
  );
}
