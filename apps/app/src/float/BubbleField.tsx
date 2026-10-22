import { motion } from 'motion/react';
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
}

const spring = { type: 'spring', stiffness: 220, damping: 26 } as const;

/** Lays out circular bubbles in a row, column or ring, animating between arrangements. */
export function BubbleField({ members, mode }: Props) {
  const [ref, bounds] = useSize<HTMLDivElement>();
  const { size, positions } = layout(mode, members.length, bounds);

  return (
    <div ref={ref} className="field">
      {members.map((m, i) => {
        const p = positions[i];
        if (!p) return null;
        return (
          <motion.div
            key={m.id}
            className="slot"
            initial={false}
            animate={{ x: p.x, y: p.y, width: size, height: size }}
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
