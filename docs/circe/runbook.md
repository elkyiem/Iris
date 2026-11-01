# Run Circé locally

Checkout: `/Users/elkyiem/Documents/GitHub/Circé`, branch `web`.
Origin: `https://github.com/elkyiem/Circe.git`.
Upstream: `https://github.com/raphaelsalaja/pond.git`.
To bring new Pond pushes into `web`, follow the [sync process](sync.md).

## Circé in the macOS Dock

After building the desktop and browser bundles, install the local Dock app:

```sh
pnpm --filter @pond/desktop install:circe:mac
```

The installer creates `~/Applications/Circé.app` with its own bundle identity and
pins it in the Dock. Opening it starts the native app and web host together,
prepares the existing Portless route, and checks/reconnects Tailscale. It uses the
existing `.artifacts/iris-web-sandbox` profile and Library. No Terminal window is
needed. Closing the app window keeps the Mac host resident; Quit Circé stops it.
Library renames and other location changes reopen the prepared host automatically.
The Dock host relaunches itself; the terminal launcher marks its child as supervised
and replaces it after exit code 75. Ordinary Quit does not restart either host.

The first launch may ask for Documents access because the checkout and Library
are there. Replacing the locally signed launcher can ask again; ordinary quit
and reopen retains the permission. If the local HTTPS proxy is stopped, macOS asks for administrator
authentication to bind port 443. Existing certificate trust is reused. The
existing DNS/HTTPS relay services and Tailnet routes must already be configured.
No new Serve ports, public access, or login-time automation are installed.

Quit Circé before reinstalling its launcher. Reinstall after moving the checkout
or changing Node/Electron versions. Ordinary source updates require rebuilding
the two bundles and reopening Circé. Reinstallation refreshes the Dock bookmark
and archives the previous owned bundle. The installed original Pond app and its
profile are separate. Launcher errors are in `~/Library/Logs/Circé/launcher.log`.

## Connect another device

On the Mac app, or a browser already connected to the Library, open **Settings →
Library → Connected browsers → Connect a device**. On the new device, open
`https://circe.elkyiem` and enter the six-digit code. The new device still needs
Tailscale, the short-address DNS setup and trust in the existing HTTPS certificate.
Pairing grants application access; it does not configure those network settings.

A code works once, expires after two minutes and is invalidated after five wrong
attempts. Generating a replacement or closing the dialog cancels the previous
code. Keep the issuing device connected until pairing finishes. The code belongs
to the exact address and Library displayed in the dialog.

**Remember this browser** is selected by default and keeps that browser connected
for a fixed 90 days, including Mac host restarts. Clear it for a twelve-hour
connection. Each browser profile is a separate connection; private browsing or
clearing site cookies loses that browser's connection. Existing sessions keep
their original twelve-hour expiry. The access-key and key-file options remain
available under **Use an access key instead**.

Any connected browser can pair another browser and disconnect listed browsers
from the same Settings section. **Forget this browser** disconnects the current
browser. Disconnecting a browser also cancels a code it has not yet used; browsers
it previously paired remain independent connections. Quit Circé on the Mac to
stop the host for every device.

## Terminal launch

For a finite offline regression check of the resident inference owner after a
merge, build first and run:

```sh
env -u ELECTRON_RUN_AS_NODE pnpm --filter @pond/desktop exec electron scripts/smoke-desktop.cjs --enrichment-owner --use-mock-keychain
```

This uses a temporary Library, verifies idle worker replacement without a model
download, and decodes bounded synthetic audio through the actual owner preload.

Use Node 24 (`.nvmrc`) and pnpm 11.27.0 (`packageManager`). For this machine:

```sh
cd /Users/elkyiem/Documents/GitHub/Circé
export PATH=/Users/elkyiem/.nvm/versions/node/v24.14.1/bin:$PATH
pnpm install --frozen-lockfile
pnpm --filter @pond/desktop build
pnpm --filter @pond/desktop build:web
CIRCE_WEB_ORIGINS=https://elkyiem.tailffeb5b.ts.net:9443 pnpm --filter @pond/desktop start:web
```

Open `http://127.0.0.1:4789`. Connect using the key in
`.artifacts/iris-web-sandbox/web-access-key`; keep its contents private. The file
picker reads a file on the visiting device, not a host filesystem path. The host
profile and disposable Library live entirely under that sandbox. Do not point
`POND_SANDBOX` at the owner's Pond profile or Library.

Only the chat designated runtime owner may start this long-running host. This
kickoff chat was explicitly designated. Other chats use finite checks and the
shared running instance. Stop with Ctrl-C before starting a replacement. Rebuild
both clients after source changes; this launcher serves production bundles and
does not watch files. It does not install or replace the installed Pond app.

Optional environment variables:

| Variable | Meaning |
| --- | --- |
| `POND_SANDBOX` | Separate disposable profile root; default `.artifacts/iris-web-sandbox` |
| `CIRCE_WEB_PORT` | Loopback listener port; default 4789 |
| `CIRCE_WEB_ORIGIN` | Primary exact browser origin; defaults to loopback HTTP |
| `CIRCE_WEB_ORIGINS` | Additional exact HTTPS origins, comma-separated; no paths or wildcard |
| `CIRCE_WEB_FIXTURES` | `1` enables offline fixtures; `0` disables them |

Fixture mode defaults to off. Set `CIRCE_WEB_FIXTURES=1` explicitly for a
disposable verification host. Then enqueue Quoted post, Original image or Video
in the browser connection bar and inspect progress in Downloads.
Repeated requests deduplicate by the original source identity. The generated
video is a four-second ffmpeg `testsrc2` clip; the image is a purpose-built graphic.
Fixture media is served only to host-loopback requests. No source login is
required and no account cookies are copied. Enabling fixtures turns on Twitter
video downloads in this disposable profile so its original video passes through
the regular fetch tasks.

## Verification

```sh
pnpm check
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @pond/desktop build:web
pnpm --filter @pond/desktop exec vitest run src/main/web src/shared/web-serialization.test.ts src/main/lib/byte-range.test.ts src/main/core/pipeline/workers/capture-tweet.test.ts src/renderer/src/features/saves/lib/media/file-viewer.test.ts
pnpm --filter @pond/desktop exec node scripts/smoke-web.mjs
# Finite browser UI check, separate temporary Chromium profile:
env -u ELECTRON_RUN_AS_NODE pnpm --filter @pond/desktop exec electron scripts/smoke-web-browser.cjs
# Stop and restart the same sandbox host, then:
pnpm --filter @pond/desktop exec node scripts/smoke-web.mjs --after-restart
```

The finite HTTP smoke reads its sandbox key privately, checks queue-backed
image/video ingestion, card files and Capture identity, original media selection,
authenticated media and ranges, folder create/add/remove, pagination and search.
It writes verification IDs inside the sandbox for the restart check. It never
reads or mutates the production Library. The browser smoke drives the actual
renderer without a preload bridge or Node integration: search, fixture enqueue,
folder create/add/remove, image/video viewing and seeking, reload, and mobile
widths. Screenshots and video state are written under
`.artifacts/web-verification`. For disconnection verification, run that script
with `--disconnect`, wait for `WEB_BROWSER_READY_FOR_DISCONNECT`, then stop only
the isolated host. It records the visible disconnection banner. Restart the same
host and run the persistence check. Live account/source checks remain separate
and require an explicitly connected test session.

## Current shared host (2026-10-28)

This chat was explicitly designated runtime owner. The rebuilt host is running
independently of T3 through `scripts/start-web-address.mjs host`, with the existing
isolated Library and rebuilt Pond 2.0.1 bundles, on loopback port 4789. Portless registers `https://circe.elkyiem`
and adds the private address `https://elkyiem.tailffeb5b.ts.net:8444`. The existing
private address `https://elkyiem.tailffeb5b.ts.net:9443` remains available too.
Runtime PID: `.artifacts/circe-runtime/host.pid`; log:
`.artifacts/circe-runtime/host.log`. Stop that owner process before starting a
replacement. It uses the same `scripts/start-web.mjs` launcher and sandbox.

```sh
# Only the designated runtime owner stops this process group:
kill -TERM -- "-$(cat .artifacts/circe-runtime/host.pid)"
```

The Portless HTTPS proxy is running on loopback port 443, and the local hostname
resolves to loopback. macOS trusts the Portless CA for SSL after the owner approved
its native authentication dialog. `security verify-cert` and
`curl https://circe.elkyiem` both pass without an explicit CA option. Login,
image/video media ranges, search, and folder operations passed through the short
address. If trust needs to be restored, run this from a local Terminal in this
checkout and approve its macOS authentication prompt:

```sh
pnpm --filter @pond/desktop exec portless trust
```

Then verify `curl https://circe.elkyiem` succeeds without a custom CA option.
Temporary administrator credential delivery files were removed after use. The
shared tailnet gateway below now makes the short address available on other
devices too. Existing web handlers remain available; the original port-443
handler runs behind the gateway on port 9445. Other Serve ports and Funnel
settings are unchanged. The launchers below work without shell-specific
environment assignment.

The launcher supplies its CA to child Node processes automatically. Standalone
smoke processes need the same setting for their Node-side fixture requests;
Chromium still verifies page certificates through macOS trust:

```sh
NODE_EXTRA_CA_CERTS="$HOME/.portless/ca.pem" CIRCE_WEB_ORIGIN=https://circe.elkyiem pnpm --filter @pond/desktop exec node scripts/smoke-web.mjs
env -u ELECTRON_RUN_AS_NODE NODE_EXTRA_CA_CERTS="$HOME/.portless/ca.pem" CIRCE_WEB_ORIGIN=https://circe.elkyiem pnpm --filter @pond/desktop exec electron scripts/smoke-web-browser.cjs
```

## Short addresses with Portless

The project is named **Circé**; GitHub and DNS use the ASCII spelling `Circe` / `circe`.
The chosen short address is `https://circe.elkyiem`.

Only the designated runtime owner starts the shared host. After building both
clients and reconnecting Tailscale, replace the stopped host with:

```sh
CIRCE_WEB_ORIGINS=https://elkyiem.tailffeb5b.ts.net:9443 pnpm --filter @pond/desktop start:web:portless
```

Portless is pinned as a development dependency. This command registers `circe`
under the custom `elkyiem` suffix, keeps the host on loopback port 4789, and
publishes a private Tailscale Serve address. The launcher prints both addresses;
the host accepts those exact origins automatically. Existing Serve routes,
including port 9443, remain separate. Portless may request local administrator
authorization to trust its development certificate and register the local name.
It does not use Funnel.

For the current tailnet, open `https://circe.elkyiem` directly on a connected
device after trusting the Mac's Portless CA once. A client-side proxy and a local
Circé checkout are not needed. The same CA covers `https://nono.elkyiem`.
`start:web:remote` remains available as a developer fallback on networks without
shared DNS; it is not part of this tailnet's normal device setup.

`CIRCE_WEB_*` settings supersede the previous `IRIS_WEB_*` names; the host still
accepts those older environment variables. The hidden sandbox name, session
cookie, upload tickets, extension ID and IndexedDB keys remain stable to retain
existing data and pairing. Rebuild/reload the unpacked Circé extension from its
new checkout path after the folder rename.

## Shared tailnet address

Tailscale split DNS sends the `elkyiem` namespace to `100.88.201.56`. A CoreDNS
service on that Tailscale IP serves the private zone; its wildcard maps app names
to the same Mac. Other DNS namespaces, global nameservers, and MagicDNS settings
were preserved. Clients must accept Tailscale DNS settings.

On the Mac, Tailscale forwards private TCP port 443 to HAProxy on loopback port
5443. HAProxy routes TLS connections with an `.elkyiem` hostname to the existing
Portless HTTPS proxy on loopback port 443. Other TLS hostnames go to the original
Tailscale HTTPS handlers on port 9445. TLS remains encrypted through the gateway;
it uses the existing certificates. The fallback listener receives the gateway's
connection. The original port-443 target on port 3000
returned 502 before this change and retains the same response afterward.

These services are shared by Circé and Nono. Restarting Circé does not require
stopping them:

| Service | macOS job | Configuration |
| --- | --- | --- |
| Private DNS | `system/com.elkyiem.tailnet-dns` | `/Library/Application Support/ElkyiemNetwork/Corefile` and `elkyiem.zone` |
| TLS gateway | `gui/501/com.elkyiem.tailnet-https` | `/Users/elkyiem/.config/elkyiem-network/haproxy.cfg` |

CoreDNS 1.15.0 and HAProxy 3.4.7 were installed with Homebrew. Their launchd jobs
start independently of T3. DNS binds only to `100.88.201.56:53`; HAProxy binds
only to `127.0.0.1:5443`. The Mac firewall remains enabled, with an allowance for
the CoreDNS executable. Root-owned DNS configuration lives outside the checkout.
DNS logs are under `/Library/Logs/ElkyiemNetwork`; gateway logs are under
`/Users/elkyiem/.config/elkyiem-network`.

Finite verification:

```sh
dig @100.100.100.100 circe.elkyiem A +short
dig @100.100.100.100 nono.elkyiem A +short
# Both return 100.88.201.56.
curl --resolve circe.elkyiem:443:100.88.201.56 https://circe.elkyiem
launchctl print system/com.elkyiem.tailnet-dns
launchctl print gui/501/com.elkyiem.tailnet-https
```

The owner confirmed `https://circe.elkyiem` loads on Windows after installing the
CA. The iPad requires that same CA to be installed and enabled for full trust in
Settings. Public certificate files are under ignored
`.artifacts/circe-device-setup/`; certificate private keys stay on the Mac.

Serve backups and the concurrency-checked routing helper are under ignored
`.artifacts/circe-runtime/shared-network/`. Do not replace Tailscale TCP port 443
with an app-specific Serve mapping; that port now carries the shared gateway.
Keep additional app-specific Serve ports separate. To restore the previous
port-443 routing, the designated network operator first removes the `elkyiem`
restricted nameserver in Tailscale DNS, then runs both phases:

```sh
python3 .artifacts/circe-runtime/shared-network/serve-routing.py unroute
python3 .artifacts/circe-runtime/shared-network/serve-routing.py rollback
```

The helper restores the original HTTPS handlers while retaining unrelated newer
Serve entries. Launchd jobs can then be unloaded if this shared setup is being
removed. Temporary API-token and administrator-password delivery files were
deleted after activation.

## Private HTTPS and the assistant

The current private URL is `https://elkyiem.tailffeb5b.ts.net:9443`. It uses the
same isolated host and access-key login. Tailscale Serve preserves the existing
routes on other ports. Recreate only Circé's mapping if needed:

```sh
tailscale serve --bg --https=9443 http://127.0.0.1:4789
# Remove only this mapping:
tailscale serve --https=9443 off
```

This is private Serve, not Funnel. Another device must be on the authorized
tailnet. Keep the host's additional origin configured when restarting it.

The isolated profile is connected to the owner's authorized ChatGPT subscription
through Pond's existing Codex CLI provider. It stores connection state, not CLI
tokens, and uses the host's file-backed CLI sign-in through the existing isolated
CLI runtime. Select **Codex → Codex Default** in the assistant composer. This
subscription connection supports text and Library tools; binary vision requires
a capable provider. No cloud API key was supplied or stored by this work.

Additional finite checks against the running host:

```sh
pnpm --filter @pond/desktop exec node scripts/smoke-web-parity.mjs
pnpm --filter @pond/desktop exec node scripts/smoke-web-canvas.mjs
pnpm --filter @pond/desktop exec node scripts/smoke-web-imports.mjs
pnpm --filter @pond/desktop exec node scripts/smoke-web-package.mjs
pnpm --filter @pond/desktop exec node scripts/smoke-web-identity.mjs
env -u ELECTRON_RUN_AS_NODE pnpm --filter @pond/desktop exec electron scripts/smoke-web-browser.cjs --identity
# Add purpose-built files to the disposable Library, then verify each viewer:
pnpm --filter @pond/desktop exec node scripts/prepare-web-viewers.mjs
env -u ELECTRON_RUN_AS_NODE pnpm --filter @pond/desktop exec electron scripts/smoke-web-browser.cjs --viewers
# New Note, real editor, persistence and reload at both widths:
env -u ELECTRON_RUN_AS_NODE pnpm --filter @pond/desktop exec electron scripts/smoke-web-browser.cjs --editing
# After restarting the same disposable host:
pnpm --filter @pond/desktop exec node scripts/smoke-web-imports.mjs --after-restart
env -u ELECTRON_RUN_AS_NODE pnpm --filter @pond/desktop exec electron scripts/smoke-web-browser.cjs --editing --after-restart
# Live model use; requires the explicitly authorized, connected subscription:
pnpm --filter @pond/desktop exec node scripts/smoke-web-agent.mjs
CIRCE_WEB_ORIGIN=https://elkyiem.tailffeb5b.ts.net:9443 pnpm --filter @pond/desktop exec node scripts/smoke-web.mjs --after-restart
```

The parity smoke checks edits/conflicts/Undo, tags, views, Canvas content conflicts,
staged upload retry, package Capture/media retention, CSV and conversion downloads,
attachment registration, video frames, authenticated compatible preview ranges
and image composition. The Canvas smoke renders actual Board tiles to PNG/PDF
and confirms it does not change the saved Canvas.
The package smoke exports the three fixtures over authenticated HTTP, imports
into a new temporary Library, re-exports, deduplicates and reopens it in a second
finite host process. It verifies Capture identity, original bytes, folder paths
and organization names. The live assistant check
uses only disposable fixture metadata and validates persisted sources and tool steps.

Viewer preparation adds twelve tagged Saves through the real upload/import path.
Run it once per fresh disposable Library; subsequent viewer checks reuse its
sandbox manifest. The finite viewer check covers desktop and mobile widths and
writes per-viewer screenshots and `viewer-results.json` under the evidence
directory. HEIC/Office preview and 3D rendering depend on the host platform and
graphics environment; the recorded acceptance run used macOS and Chromium.

The identity smoke prepares a purpose-built logo, verifies upload/normalization,
portable metadata, validation, reset and the public default favicon, and restores
the prior Library logo. Run it before the finite `--identity` browser check,
which uses that fixture with Chromium's real file chooser protocol and verifies
the shared Settings UI, custom tab icon, reload and reset. It restores the prior
logo too. These checks are also part of the isolated CI driver.

## Connect the browser extension to Circé

```sh
pnpm --filter @pond/extension build:circe
```

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load
unpacked**, and select
`/Users/elkyiem/Documents/GitHub/Circé/apps/extension/.output-circe/chrome-mv3`.
This build is named Circé and has a separate ID from Pond. Do not change the
installed Pond native-host manifests. Chrome's extension manager must be opened
by the owner because the collaborative browser URL policy blocks that protocol.

Open the Circé extension panel → **Connection**. Enter
`https://elkyiem.tailffeb5b.ts.net:9443` and choose the host's `web-access-key`
file. On the Mac its full path is
`/Users/elkyiem/Documents/GitHub/Circé/.artifacts/iris-web-sandbox/web-access-key`.
Use Cmd-Shift-G in the file picker to reach the hidden directory. **Connect Circé**
authorizes this extension for this host and Library. The bootstrap key is cleared
after pairing; a separate, revocable credential stays in the extension.

Refresh Circé and any already-open X tab after loading the extension. In Circé,
choose **Sources → New Source → Twitter**. The paired extension uses the X
session in its own Chrome profile; if signed out, it reuses an existing Source
tab or opens one in that browser. Then choose the import scope and start it.
Nothing syncs from a new Account until its import scope is confirmed. A remote
Circé page can also request connection from the paired browser on the Mac; its
worker checks the host every 30 seconds, subject to the existing retry pacing.

Ordinary bookmarks/likes on supported pages use the existing hooks and capture
queue. Scheduled collection remains host-owned, so Chrome need not stay open for
the host to sync an already-connected Account. **Disconnect Circé** revokes the
extension credential; it does not remove Source Accounts already connected on
the host. Disconnect those separately in Sources. An unreachable host must be
reachable again for the panel to revoke its credential. Re-pair after changing
the host address or active Library. Never paste credentials into logs or chat.

Without a paired extension, New Source explains that pairing is required; it
does not automatically open a separate host window. The desktop path remains
unchanged. Do not manually extract browser cookies or repoint the installed Pond
native host. The owner has loaded and paired this Chromium build; live Twitter
connection, a full list walk and a manual duplicate capture passed. Other Sources,
automatic like/bookmark hooks and remote Firefox pairing remain pending.

A first list sync can finish while media are still being processed. Downloads
shows those Save jobs separately. Pond's existing hourly/daily Source budgets
may defer them; leave the host running for their scheduled resume rather than
repeatedly restarting or forcing retries. A successful list walk does not prove
that every original is still available on the Source.

The current direct-download path also has an upstream 50 MiB ceiling even when
the video preference allows larger files. Oversized originals are now classified
as size-limit failures; older stored failures may still say “permanently
unavailable.” Increasing that preference alone does not remove this ceiling.

Finite transport/queue/restart verification, without a live Source session:

```sh
pnpm --filter @pond/desktop exec node scripts/smoke-web-extension.mjs
# Stop and restart only the isolated host, then:
pnpm --filter @pond/desktop exec node scripts/smoke-web-extension.mjs --after-restart
```

The fixture creates a separate temporary extension credential and a generated
image through the existing capture queue. The restart check verifies the Save
and credential survived, then revokes only that test credential. Its private
state file stays in the ignored sandbox with mode 0600 until cleanup.
Run this setup check in a fresh disposable profile before connecting real
Accounts: it assumes no previous pairing and temporarily requests a Source
connection. Do not run it against an active live import.


## Production browser and PWA verification

The production shell hides fixture controls and the healthy connection bar.
Settings → General → This Browser owns Disconnect, with confirmation. Sessions
survive a same-Library host replacement until expiry; Disconnect durably revokes
that browser. A temporary host failure shows reconnect guidance.

The browser can be installed using its platform's ordinary Install/Add to Home
Screen command after HTTPS trust is configured. The manifest and app icons are
served from the shared address. Offline mode shows a reconnect explanation;
Library browsing and editing require the Mac host to be awake and reachable.
No private Library response is stored in the PWA cache.

The finite browser harness has standalone probes for `--library-admin`,
`--host-maintenance`, `--file-actions`, `--previews`, `--replay`, `--interactions`,
`--eagle`, `--library-copy-storage`, `--settings-preview`, `--transfers` and
`--pwa-shell` and `--import-formats`. Use the existing runtime with exclusive GUI ownership. These
probes create explicitly owned content or temporarily adjust device presentation,
verify original identity/preferences, and restore their fixtures. They are not
a substitute for the offline suite or physical-device acceptance. Recovery
variants exist for stateful probes; use their recorded ownership evidence.

`--fonts` additionally installs one unique synthetic font through the real native
owner and verifies visibility from fresh CoreText processes. It requires an
explicit runtime-owner grant and `CIRCE_FONT_ACTIVATION_GRANTED=1`; it must never
be run opportunistically alongside personal font work. Its cleanup validates the
exact owned font path, sidecar, inode and checksum before native deactivation.
