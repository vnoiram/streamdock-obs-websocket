# streamdock-obs-websocket

Mirabox Stream Dock JavaScript/HTML plugin for controlling OBS on another PC through OBS WebSocket.

Initial target endpoint format:

```text
wss://<OBS-PC-IP>:4455
```

## Version

Current version: `0.2.4`.

Notable release updates:

- Added `npm run clean` for removing generated `dist/` output.
- Added `npm run release:zip` as the standard release entry point, with OS auto-detection.
- Added explicit `npm run release:zip:windows` and `npm run release:zip:linux` commands.
- Release zips now include the manifest version in the filename.

Actions:

- Stream Toggle
- Record Toggle
- Scene
- Source Mute
- Source Volume
- Replay Save
- Source Visibility
- Studio Transition
- Source Meter
- Source Filter
- Stats
- Virtual Camera
- Studio Mode
- Scene Collection
- Profile
- Diagnostics
- Stats display
- Explicit start/stop stream and recording operations
- Source filter enable/disable
- Optional connection presets and second-press confirmation for dangerous operations
- Generated key images that reflect OBS state: offline, live, recording, scene, source mute, and level meter states.
- Stream and record actions show elapsed time while active.
- Added virtual camera toggle, studio mode toggle, forced show/hide visibility modes, absolute source-volume setting, and named studio transition triggering.
- Property Inspector auto-syncs OBS lists when opened, fetches scene items for the selected scene, fetches source filters for the selected source, and warns when configured scene/source/item/filter/profile/collection names are missing from the current OBS lists.
- Property Inspector `Repair`, `Preflight`, and `Diagnose` help recover renamed OBS scenes/sources and validate remote endpoint safety.
- Added Property Inspector diagnostic log copy and clearer combined LIVE+REC state titles/images.

The plugin speaks OBS WebSocket v5 directly from the Stream Dock plugin runtime. It handles the OBS `Hello` and `Identify` flow and computes authentication when a password is configured.

Implemented operations:

- `ToggleStream`
- `ToggleRecord`
- `SetCurrentProgramScene`
- `ToggleInputMute`
- `SetInputVolume`
- `SaveReplayBuffer`
- `GetSceneItemId`
- `GetSceneItemEnabled`
- `SetSceneItemEnabled`
- `TriggerStudioModeTransition`
- `SetCurrentSceneCollection`
- `SetCurrentProfile`
- `GetStats`
- `StartStream` / `StopStream`
- `StartRecord` / `StopRecord`
- `SetSourceFilterEnabled`
- `ToggleVirtualCam`
- `SetStudioModeEnabled`
- `TriggerStudioModeTransition` with optional transition name

## Repository Layout

- `manifest.json`: Stream Dock plugin manifest.
- `plugin.html` / `plugin.js`: Stream Dock runtime plugin.
- `property-inspector.*`: Stream Dock settings UI.
- `icons/`: plugin icon assets.
- `scripts/package-plugin.js`: creates a distributable `.sdPlugin` directory.

## Stream Dock Plugin

Package this repository root as the plugin directory, or copy these files into a Stream Dock plugin folder:

- `manifest.json`
- `plugin.html`
- `plugin.js`
- `property-inspector.html`
- `property-inspector.js`
- `property-inspector.css`
- `icons/`

No local helper is required. The plugin connects directly to OBS WebSocket v5 from the Stream Dock plugin runtime.

Build a distributable plugin folder:

```bash
npm run package
```

Clean build output:

```bash
npm run clean
```

The output is written under `dist/`.

Create a release zip for the current OS:

```bash
npm run release:zip
```

Create a release zip explicitly on Windows/PowerShell:

```powershell
npm run release:zip:windows
```

Create a release zip explicitly on Linux:

```bash
npm run release:zip:linux
```

## OBS Setup

1. On the OBS PC, enable OBS WebSocket.
2. Confirm the WebSocket port, normally `4455`.
3. Set a WebSocket password if desired.
4. Ensure the Stream Dock PC can reach the OBS WebSocket endpoint, preferably `wss://<OBS-PC-IP>:4455` when TLS is available.
5. In the Property Inspector, set:
   - `Endpoint`: `wss://<OBS-PC-IP>:4455` for TLS, or the local/trusted-network OBS WebSocket URL when TLS is unavailable.
   - `Password`: OBS WebSocket password, if configured. Typing a password enables `Store pass`; uncheck `Store pass` to remove the saved password.
   - `Operation`: stream, record, scene, mute, or volume.
   - `Scene` or `Source`: required for scene/source operations.
6. Use the Property Inspector's `Refresh` button to fetch current OBS scenes, scene items, inputs, profiles, collections, and source filters for autocomplete. The Property Inspector also attempts this sync when opened.
7. Use `Diagnostics` to copy recent Property Inspector diagnostics.

The Property Inspector warns when the OBS endpoint points at another machine, and especially when a remote endpoint has no password entered. For remote OBS control, keep the OBS WebSocket port firewalled to trusted clients.

The plugin subscribes to OBS events and reflects stream/record state. Stream and record keys show elapsed time, using OBS output duration when available. The Source Meter action shows a simple level percentage when OBS sends input meter events.

For Source Visibility, set `Scene` first, then press `Refresh`. The `Scene item` field is populated from `GetSceneItemList` for that scene, which helps avoid accidentally selecting a source that is not in the scene.

Key images are generated locally from state. For example, stream actions show `LIVE ON/OFF`, record actions show `REC ON/OFF`, meter actions show the current level, and offline actions show `OBS OFF`.
When stream and recording are both active, stream-oriented keys show `LIVE+REC` / `LIVE REC` so the combined state is visible at a glance.

## Build

There is no compiled helper. The plugin consists of static Stream Dock files.

Run local checks:

```bash
npm run check
```
