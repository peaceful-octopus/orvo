import { pickGifSource, type GifMode, type GifSource } from '@chillcall/effects';
import type { IGif } from '@giphy/js-types';
import { Grid, SearchBar, SearchContext, SearchContextManager } from '@giphy/react-components';
import { useContext, useEffect, useState } from 'react';

interface Props {
  apiKey: string;
  onPick(source: GifSource, mode: GifMode): void;
  onClose(): void;
}

function Results({ width, onSelect }: { width: number; onSelect(gif: IGif): void }) {
  const { fetchGifs, searchKey } = useContext(SearchContext);
  // Keying the grid on the search term restarts the results whenever the term changes.
  return (
    <Grid
      key={searchKey}
      columns={3}
      width={width}
      gutter={6}
      fetchGifs={fetchGifs}
      noLink
      hideAttribution
      onGifClick={(gif, e) => {
        e.preventDefault();
        onSelect(gif);
      }}
    />
  );
}

/** Search box and results grid from the Giphy SDK. Loaded on demand so the SDK stays out of the main bundle. */
export default function GifPicker({ apiKey, onPick, onClose }: Props) {
  const [replace, setReplace] = useState(false);
  const [unusable, setUnusable] = useState(false);
  const width = Math.min(440, window.innerWidth - 48);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const select = (gif: IGif) => {
    const mode: GifMode = replace ? 'fill' : 'sticker';
    const source = pickGifSource(gif.images as never, mode);
    if (!source) return setUnusable(true);
    onPick(source, mode);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Choose a GIF" onClick={(e) => e.stopPropagation()}>
        <SearchContextManager apiKey={apiKey} shouldFetchChannels={false} options={{ rating: 'pg' }}>
          <SearchBar placeholder="Search GIPHY" />
          <div className="gif-results">
            <Results width={width} onSelect={select} />
          </div>
        </SearchContextManager>
        {unusable && <p className="error">That GIF is not available in a usable format. Try another.</p>}
        <div className="gif-footer">
          <label>
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace my video
          </label>
          <a href="https://giphy.com" target="_blank" rel="noreferrer">
            Powered by GIPHY
          </a>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
