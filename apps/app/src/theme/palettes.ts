/**
 * Colour palettes. Every colour in the interface comes from a role below, never from a literal in a stylesheet or a
 * component, so a palette can be added, changed or removed here without touching anything else.
 *
 * To add a palette: copy one entry, give it a new key and label, and adjust the colours. `palettes.test.ts` checks
 * that every palette keeps text readable. Palettes appear in Settings automatically once there is more than one.
 */

export interface Tokens {
  /** Page background. */
  bg: string;
  /** Panels, inputs and the controls bar. */
  surface: string;
  /** Something sitting on a surface: a menu, a pressed control, a video's empty circle. */
  raised: string;
  /** A control under the pointer. */
  hover: string;
  /** Quiet outlines between areas. */
  border: string;
  /** Outlines of things you operate: inputs, buttons, sliders. */
  borderStrong: string;
  text: string;
  /** Secondary text and icons. */
  muted: string;
  /** The one primary action on a screen, and the selected state. */
  accent: string;
  accentHover: string;
  /** Text and icons on the accent colour. */
  onAccent: string;
  /** Something is live, working or on. */
  live: string;
  /** Leave, and controls that are switched off. */
  danger: string;
  dangerHover: string;
  onDanger: string;
  /** Keyboard focus ring. */
  focus: string;
  /** The empty part of a slider. */
  track: string;
  /** Dims the page behind a dialog. */
  scrim: string;
  /** Backdrop that fades in over the floating window so its edges show. */
  edge: string;
  /** Name tags over a video: the same in every palette, because they sit on camera images, not on the page. */
  caption: string;
  onCaption: string;
}

export interface Palette {
  label: string;
  dark: Tokens;
  light: Tokens;
}

export const PALETTES: Record<string, Palette> = {
  evening: {
    label: 'Evening',
    dark: {
      bg: '#1B1714',
      surface: '#26201B',
      raised: '#302822',
      hover: '#3B322A',
      border: '#433830',
      borderStrong: '#7C6B5A',
      text: '#F6EEDF',
      muted: '#B8A994',
      accent: '#FF7A3D',
      accentHover: '#FF9059',
      onAccent: '#1B1714',
      live: '#A8D672',
      danger: '#D0343C',
      dangerHover: '#B82C33',
      onDanger: '#FFFFFF',
      focus: '#FFB27F',
      track: '#43382F',
      scrim: 'rgba(16, 12, 9, 0.72)',
      edge: 'rgba(27, 23, 20, 0.5)',
      caption: 'rgba(0, 0, 0, 0.62)',
      onCaption: '#FFFFFF',
    },
    light: {
      bg: '#FAF4E8',
      surface: '#FFFDF8',
      raised: '#F3EADA',
      hover: '#EBDFCB',
      border: '#E0D2BB',
      borderStrong: '#9A8567',
      text: '#2A2018',
      muted: '#6B5B4B',
      accent: '#BA3F0E',
      accentHover: '#A63609',
      onAccent: '#FFFFFF',
      live: '#3A7420',
      danger: '#C42B33',
      dangerHover: '#A82229',
      onDanger: '#FFFFFF',
      focus: '#BA3F0E',
      track: '#E0D2BB',
      scrim: 'rgba(42, 32, 24, 0.45)',
      edge: 'rgba(250, 244, 232, 0.6)',
      caption: 'rgba(0, 0, 0, 0.62)',
      onCaption: '#FFFFFF',
    },
  },

  // From coolors.co/6dd3ce-c8e9a0-f7a278-a13d63-351e29: teal, light green, peach, berry and plum. Dark mode is plum with
  // peach as the accent; light mode is a pale green with berry as the accent. The teal is the "live" colour in both.
  beach: {
    label: 'Beach Day',
    dark: {
      bg: '#2A1721',
      surface: '#351E29',
      raised: '#43283A',
      hover: '#4F3044',
      border: '#4D3341',
      borderStrong: '#9A7A8A',
      text: '#F6F1E7',
      muted: '#C9B3BE',
      accent: '#F7A278',
      accentHover: '#FFB892',
      onAccent: '#2A1721',
      live: '#6DD3CE',
      danger: '#D0343C',
      dangerHover: '#B82C33',
      onDanger: '#FFFFFF',
      focus: '#C8E9A0',
      track: '#4D3341',
      scrim: 'rgba(20, 9, 15, 0.72)',
      edge: 'rgba(42, 23, 33, 0.5)',
      caption: 'rgba(0, 0, 0, 0.62)',
      onCaption: '#FFFFFF',
    },
    light: {
      bg: '#F4FAEA',
      surface: '#FFFFFF',
      raised: '#E6F4D3',
      hover: '#D9EDC0',
      border: '#CFE3B8',
      borderStrong: '#7A8F6B',
      text: '#351E29',
      muted: '#6A4E5C',
      accent: '#A13D63',
      accentHover: '#8A3354',
      onAccent: '#FFFFFF',
      live: '#1B8A83',
      danger: '#B3261E',
      dangerHover: '#951E18',
      onDanger: '#FFFFFF',
      focus: '#A13D63',
      track: '#CFE3B8',
      scrim: 'rgba(53, 30, 41, 0.45)',
      edge: 'rgba(244, 250, 234, 0.6)',
      caption: 'rgba(0, 0, 0, 0.62)',
      onCaption: '#FFFFFF',
    },
  },

  midnight: {
    label: 'Midnight',
    dark: {
      bg: '#14121F',
      surface: '#1B1830',
      raised: '#231F38',
      hover: '#2D2850',
      border: '#3B3560',
      borderStrong: '#6B6495',
      text: '#F4F1FF',
      muted: '#B9B2D8',
      accent: '#6A5CFF',
      accentHover: '#5B4DF0',
      onAccent: '#FFFFFF',
      live: '#7EE0A8',
      danger: '#C93A62',
      dangerHover: '#B03257',
      onDanger: '#FFFFFF',
      focus: '#8F84FF',
      track: '#251F45',
      scrim: 'rgba(10, 8, 20, 0.7)',
      edge: 'rgba(20, 18, 31, 0.5)',
      caption: 'rgba(0, 0, 0, 0.62)',
      onCaption: '#FFFFFF',
    },
    light: {
      bg: '#F6F4FF',
      surface: '#FFFFFF',
      raised: '#ECE8FF',
      hover: '#E1DBFF',
      border: '#D3CCF2',
      borderStrong: '#8E86BD',
      text: '#1E1A33',
      muted: '#5B5580',
      accent: '#5A4BEF',
      accentHover: '#4A3BD9',
      onAccent: '#FFFFFF',
      live: '#1F7A4D',
      danger: '#C42B5A',
      dangerHover: '#A82049',
      onDanger: '#FFFFFF',
      focus: '#5A4BEF',
      track: '#D3CCF2',
      scrim: 'rgba(30, 26, 51, 0.45)',
      edge: 'rgba(246, 244, 255, 0.6)',
      caption: 'rgba(0, 0, 0, 0.62)',
      onCaption: '#FFFFFF',
    },
  },
};

export const DEFAULT_PALETTE = 'evening';

export type Mode = 'dark' | 'light';
