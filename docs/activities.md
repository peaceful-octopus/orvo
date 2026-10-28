# Activities

An activity is a small web page the server offers and the people in a call run together: a game, a shared player, a whiteboard. The client does not contain any of them. It learns which activities exist from the server's signed config, loads the chosen one into a sandboxed frame, and carries messages between the frames of everyone who has it open.

Snake (`apps/server/activities/snake`) is the sample. Read its `snake.js` alongside this document.

## How it works

1. The server lists its activities in the signed `ClientConfig` (`activities`). Clients show them in the Play menu.
2. Someone picks one. Their client sends `activity` over the call's data channel and opens the page in an iframe. They are the **host**: the activity is theirs to run, and it ends when they close it or leave.
3. Everyone else is told something is running (a dot on the Play button) and opens it when they choose to.
4. Each open frame announces itself with `activity-presence`. The frame of every participant is told who else has it open.
5. Frames talk through the app with `send` and `message`. The app sends these as `activity-msg` over the peer-to-peer data channel. The server never sees activity traffic.

The host's frame is the authority. In Snake the host runs the game rules and sends the state each step; guests send only the direction they want to turn. The API does not enforce this, but it fits a call with no server-side state, and it keeps one participant's frame from having to agree with the others about the rules.

Only one activity runs in a call at a time. If two people start one at the same moment, everyone settles on the one with the smaller instance id.

## Offering activities (server)

The all-in-one server reads activities from two places. A later directory replaces an earlier activity with the same id.

1. `apps/server/activities`, which ships with the server.
2. `ACTIVITIES_DIR`, default `<DATA_DIR>/activities`, for the operator's own.

Each activity is a directory named after its id, containing `manifest.json` and the files it needs:

```json
{
  "id": "snake",
  "name": "Snake",
  "description": "Race to eat the most while avoiding walls and each other.",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.html",
  "icon": "🐍",
  "minPlayers": 1,
  "maxPlayers": 8,
  "capabilities": []
}
```

- `id` must match the directory name: lowercase letters, digits and hyphens, up to 32 characters.
- `entry` is a page inside the directory and defaults to `index.html`. The published manifest carries the full path `/activities/<id>/<entry>`.
- `maxPlayers` cannot exceed the room limit (10).
- `capabilities` lists extra abilities the activity wants from the app. API version 1 grants none.

An activity whose manifest is invalid, or whose entry page is missing, is skipped, and the server logs why. The rest still load. The list is read at startup, so adding an activity needs a restart.

Files are served under `/activities/<id>/` with these headers:

- `Access-Control-Allow-Origin: *`, because the frame has no origin of its own and needs CORS for module scripts.
- `Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'none'`. An activity can load its own files but cannot contact anything, so it cannot send what it sees in a call elsewhere. Everything it needs has to be in its directory.

The standalone beacon (`apps/beacon` on its own) does not serve activities yet; they are part of the all-in-one server.

## Writing an activity

The page runs in `<iframe sandbox="allow-scripts">`. It has no origin of its own: no access to the app's storage, cookies, camera, microphone or network. Its only link to the world is `postMessage` to `window.parent`.

Copy `orvo-activity.js` (in the Snake directory) next to your page:

```js
import { connect } from './orvo-activity.js';

const orvo = await connect();
orvo.self;          // { id, name }
orvo.host;          // id of the participant who runs the activity
orvo.isHost;        // whether that is you
orvo.participants;  // everyone with the activity open, you included; kept up to date
orvo.theme;         // the app's CSS custom properties (--bg, --text, --accent, ...), already applied to :root

orvo.send(data);               // to every other participant
orvo.send(data, someId);       // for one participant; the others ignore it
orvo.onMessage(({ from, data }) => { /* ... */ });
orvo.onParticipants((all, change) => { /* change is { joined } or { left } */ });
orvo.onClose(() => { /* the activity ended */ });
orvo.end();                    // host only: ends it for everyone
```

Rules to design around:

- **Your own messages do not come back to you.** Apply your own input locally.
- **`data` is JSON, at most 8 KB per message**, and an activity may send 60 messages per second. Messages beyond that are dropped. Snake sends one small state message per step (about 9 a second).
- **`to` is routing, not privacy.** Every call participant's client receives every message and discards those not addressed to them.
- **Late joiners get nothing replayed.** If a newcomer needs the current picture, the host sends it when `onParticipants` reports them (Snake does this).
- **Keyboard input needs focus.** Keys reach the frame only after it has focus. The app focuses it when it loads, and your page should show a hint when `document.hasFocus()` is false.
- **If the host leaves, the activity ends** for everyone. There is no host migration yet.
- **Floating windows.** In the desktop app, floating the call moves the activity into a window of its own, always on top, that you can place and resize apart from the bubbles. It starts beside the bubble window and remembers its size. The call window still runs the bridge, so everything the frame sends is checked there; the activity window only carries messages between its frame and the call window. Floating or docking gives the activity a new frame, so the page reloads and its state is lost: a host's game returns to its lobby. The floating controls have a Play button with the same menu as the docked window. Drag the activity window by its title bar.

## Host API reference (version 1)

Messages are objects with `orvo: 1` and a `type`. The `orvo-activity.js` module hides them; this section is for writing a different SDK. The schemas are in `packages/protocol/src/activity.ts` (`ActivityHostMessage`, `ActivityGuestMessage`).

From the app to the activity:

| type | fields |
| --- | --- |
| `init` | `apiVersion`, `instanceId`, `self {id,name}`, `host`, `isHost`, `participants [{id,name}]`, `theme {name: value}`, `capabilities []` |
| `participant-joined` | `participant {id,name}` |
| `participant-left` | `id` |
| `message` | `from`, `data` |
| `close` | none |

From the activity to the app:

| type | fields |
| --- | --- |
| `ready` | none. Send it once the page is listening; the app answers with `init`. |
| `send` | `data`, optional `to` |
| `end` | none. Host only; ignored from anyone else. |

The app ignores anything that does not match, anything sent before `ready`, and anything not posted by the activity's own frame.

## Wire format

Activity messages are three `DataMessage` kinds (`packages/protocol/src/datachannel.ts`), carried on the existing peer-to-peer `ctl` channel. Clients that do not know them drop them.

| kind | fields | replayed to late joiners |
| --- | --- | --- |
| `activity` | `instanceId` (or `null` to end), `activityId` | yes |
| `activity-presence` | `instanceId` or `null` | yes, per sender |
| `activity-msg` | `instanceId`, optional `to`, `data` | no |

Replay uses the mesh's per-kind cache of the last message sent. `activity-msg` is an event stream, so it is excluded from it (`isReplayedKind`).

## Versioning

`apiVersion` in the manifest is the host API version the activity was written for. A client skips activities whose version it does not implement, and shows "needs a newer version of Orvo" for a running activity it cannot open. One unsupported manifest never invalidates the config, because the version is validated only as a positive integer.

## Not in version 1

- A jukebox. It needs a granted `audio` capability and a place in the microphone path (`apps/app/src/noise.ts`) to mix music in after noise suppression.
- Host migration, several activities at once, and keeping an activity's state when the window floats or docks.
- Limits on who may embed an activity. The CSP has no `frame-ancestors`, so any website can embed an activity page. `*` is not an option: WebKit does not match it against the desktop app's `tauri://localhost` scheme and refuses to load the frame (the macOS app showed an empty pane). That is acceptable while activities cannot change anything outside their own frame. **Do this before the API gains state-changing abilities** (acting for the user, sending messages, spending anything), because a hostile page could then frame the activity and trick someone into clicking it (clickjacking). The server would build the header per request from `'self'`, the desktop origins (`tauri://localhost`, `http://tauri.localhost`) and an operator setting such as `APP_ORIGINS` for a web app hosted elsewhere. It cannot reflect the requester's origin, because the frame sends no `Referer` (`referrerpolicy="no-referrer"`) and navigation requests carry no `Origin`. Confirm that an explicit `tauri://localhost` entry matches in WebKit on a Mac before relying on it.
- Signing of third-party activities. Today the operator decides what the server offers, and the sandbox limits what any activity can do.
