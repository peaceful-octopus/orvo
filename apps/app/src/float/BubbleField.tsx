import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { Bubble } from '../Bubble';
import { layout, type LayoutMode } from './layouts';
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

interface Props {
  members: Member[];
  mode: LayoutMode;
  /** Largest bubble diameter; omit for the default cap. */
  maxSize?: number;
}

const spring = { type: 'spring', stiffness: 220, damping: 26 } as const;

/** Lays out circular bubbles in a row, column or ring, animating between arrangements. */
export function BubbleField({ members, mode, maxSize }: Props) {
  const [ref, bounds] = useSize<HTMLDivElement>();
  const { size, positions } = layout(mode, members.length, bounds, maxSize);

  // Whoever is here when the field first appears is simply there; people who arrive later pop in.
  const known = useRef<Set<string> | null>(null);
  const first = known.current === null;
  useEffect(() => {
    known.current = new Set(members.map((m) => m.id));
  });

  return (
    <div ref={ref} className="field">
      {members.map((m, i) => {
        const p = positions[i];
        if (!p) return null;
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
    </div>
  );
}
