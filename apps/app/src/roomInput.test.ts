import { describe, expect, it } from 'vitest';
import { parseRoomInput, roomLink } from './roomInput';

describe('parseRoomInput', () => {
  it('accepts a room name', () => {
    expect(parseRoomInput('sleepy-creek-star-xuyh5xow')).toBe('sleepy-creek-star-xuyh5xow');
  });

  it('ignores case and surrounding space, and turns inner spaces into hyphens', () => {
    expect(parseRoomInput('  Movie Night ')).toBe('movie-night');
  });

  it('takes the room from a pasted link', () => {
    expect(parseRoomInput('https://orvo.example.com/r/sleepy-creek-star-xuyh5xow')).toBe('sleepy-creek-star-xuyh5xow');
    expect(parseRoomInput('http://localhost:8080/r/movie-night/?ice=relay#x')).toBe('movie-night');
    expect(parseRoomInput('orvo.example.com/r/Movie-Night')).toBe('movie-night');
  });

  it('rejects empty, too short, and unusable names', () => {
    for (const bad of ['', '   ', 'ab', 'no_underscores', 'emoji-🎉', 'https://example.com/', 'a'.repeat(65)]) {
      expect(parseRoomInput(bad)).toBeNull();
    }
  });
});

describe('roomLink', () => {
  it('builds the address on the server the app uses', () => {
    expect(roomLink('movie-night', 'https://orvo.example.com')).toBe('https://orvo.example.com/r/movie-night');
    expect(roomLink('movie-night', 'http://localhost:8080')).toBe('http://localhost:8080/r/movie-night');
  });
});
