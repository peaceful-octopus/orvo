import { startWindowResize, type ResizeEdge } from './float';

const EDGES: ResizeEdge[] = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'];

/**
 * Invisible strips along the window's edges and corners that start a resize when pressed. The system's own resize
 * border on this undecorated window is a pixel or two wide and hard to hit; these are wider.
 */
export function ResizeHandles() {
  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge}
          className={`resize-handle ${edge.toLowerCase()}`}
          onMouseDown={(e) => {
            e.stopPropagation(); // the window is dragged by its content, which these must not start
            void startWindowResize(edge);
          }}
        />
      ))}
    </>
  );
}
