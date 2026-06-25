# streamdock-obs-websocket

Mirabox Stream Dock JavaScript/HTML plugin for controlling OBS on another PC through OBS WebSocket.

Initial target endpoint format:

```text
ws://<OBS-PC-IP>:4455
```

## Version

Current version: `0.2.0`.

Notable `0.2.0` updates:

- Added `npm run clean` for removing generated `dist/` output.
- Added `npm run release:zip` as the standard release entry point.
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
- Scene Collection
- Profile
- Diagnostics
- Stats display
- Explicit start/stop stream and recording operations
- Source filter enable/disable
- Optional connection presets and second-press confirmation for dangerous operations

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

Create a release zip on Windows/PowerShell:

```powershell
npm run release:zip
```

## OBS Setup

1. On the OBS PC, enable OBS WebSocket.
2. Confirm the WebSocket port, normally `4455`.
3. Set a WebSocket password if desired.
4. Ensure the Stream Dock PC can reach `ws://<OBS-PC-IP>:4455`.
5. In the Property Inspector, set:
   - `Endpoint`: `ws://<OBS-PC-IP>:4455`
   - `Password`: OBS WebSocket password, if configured.
   - `Operation`: stream, record, scene, mute, or volume.
   - `Scene` or `Source`: required for scene/source operations.
6. Use the Property Inspector's `Refresh` button to fetch current OBS scenes and inputs for autocomplete.

The plugin subscribes to OBS events and reflects stream/record state. The Source Meter action shows a simple level percentage when OBS sends input meter events.

## Build

There is no compiled helper. The plugin consists of static Stream Dock files.

Run local checks:

```bash
npm run check
```
