# Design

The look is "warm evening": a charcoal-brown background with cream text and one orange accent, in light and dark
versions. Two more palettes ship beside it to show that palettes swap freely: "Midnight" (the earlier violet look) and "Beach Day"
(teal, light green, peach, berry and plum, from [this Coolors palette](https://coolors.co/6dd3ce-c8e9a0-f7a278-a13d63-351e29)).

## Rules

- **Colour carries meaning.** Orange marks the one primary action on a screen and the selected state. Green means
  live or working. Red means leave, or something switched off. Nothing is coloured for decoration.
- **Shape tells you what a thing is.** Circles are for bubbles and icon buttons. Text buttons and inputs use a 10px
  radius. Panels, menus and the control bar use 18px.
- **Flat surfaces.** Panels are solid fills with a thin border. No shadows, no blur, no translucent glass. The only
  translucency is the dimming behind a dialog, the name tag over a video, and the backdrop that fades in over the
  floating window so its edges show.
- **One primary action per screen**, bigger and heavier than everything else, which stays quiet.
- **Show less.** Server and privacy options live in Settings → Advanced; device choices sit behind a "Devices" line in
  the lobby.
- **Design the other states.** Being alone in a room, access to the camera or microphone refused, a failed noise
  filter, a full room and a lost connection each have their own message and a next step. Their wording is in
  `apps/app/src/copy.ts`.
- **Motion has a job.** Buttons respond to a press; people pop in when they join; backdrops fade. Durations are
  `--dur-fast` and `--dur`. Motion is reduced when the system asks for that.

## Type

Bricolage Grotesque (headings, names, big numbers) and DM Sans (everything else), both under the SIL Open Font
License and bundled with the app through `@fontsource-variable`, so nothing is fetched from a font service.

## Icons

[Lucide](https://lucide.dev) (ISC) at 20px with a 2px stroke. Four icons Lucide does not have (GIF and the three
layouts) are drawn on the same grid in `apps/app/src/float/icons.tsx`.

## Colour palettes

Every colour comes from a role (`bg`, `surface`, `accent`, `onAccent`, and so on) defined in
`apps/app/src/theme/palettes.ts`. `theme.ts` writes the active palette onto the page as CSS custom properties
(`--bg`, `--accent`, ...), and the stylesheet only ever uses those. A test fails if a stylesheet rule contains a
literal colour.

**To add or change a palette**, copy an entry in `PALETTES`, give it a key and a label, and edit its `dark` and `light`
sets. `palettes.test.ts` checks every palette for readable text (4.5:1) on every surface, readable text on the accent
and danger fills (including their hover colours), and visible borders, focus rings and sliders (3:1). It appears in
Settings → Appearance → Colours as soon as there is more than one.

Light or dark follows the system by default and can be forced in Settings. The floating controls window and any
Picture-in-Picture window follow the same palette.

## Reviewing a change

`pnpm test:e2e:visual` photographs the landing page, lobby, call (alone and with two people, with a menu open) and
Settings in all four palette and mode combinations, into `test-results/screens`.
