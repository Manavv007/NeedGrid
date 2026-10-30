# Live updates and big-screen mode (C-5)

Owner: C (frontend). Server side: A's `apps/api/src/routes/stream.ts` and `apps/api/src/lib/events.ts`.

## How it works

- The API streams `GET /api/orgs/:slug/stream` (Server-Sent Events). Each event is `need.updated` (`NEED_UPDATED_EVENT`)
  with one `NeedCard` as JSON. The server sends `retry: 3000` and a `: ping` comment every 25 s, never sends drafts,
  and answers 404 for an unknown charity.
- `useOrgStream(slug)` (`apps/web/src/lib/sse.ts`) opens one `EventSource` per charity, shared by every component on
  the page and closed when the last one unmounts. It parses each event with the shared `NeedCard` schema (a bad event
  is logged in dev and skipped) and patches the TanStack Query cache with the card exactly as the server sent it:
  - `["org", slug]`: the need is replaced by id, added if new, removed if it became a draft. Stats are not touched;
    the whole org page is refetched at most once per 10 s instead, so "Raised so far" catches up.
  - `["need", id]`: `need` is replaced when that page is cached.
  - `["staffNeeds", …]`: invalidated.
- Status: `connecting`, `live`, `reconnecting` (the browser is retrying; the "Reconnecting live updates…" pill shows)
  and `closed` (the server refused the stream, e.g. 404; browsers don't retry that and neither do we).
- After a reconnect the org page, need pages and staff lists are refetched, since events may have been missed.
- Mounted on the tile wall (`/o/:slug`), the need page and the staff console (`/staff`).

## What people see and hear

- Progress bars animate from the old to the new width in about 600 ms (held segment too); no animation with
  `prefers-reduced-motion`.
- Each page has one `aria-live="polite"` region for live changes, at most one message per 5 s (a burst is read as its
  latest message): "Diapers, size 4: $14 left", "Diapers, size 4 is fully funded". Changes this tab made itself
  (a donor's own payment, a staff edit) are not announced.
- Tile wall: a tile that gets funded moves from Still needed to Funded (counts follow) and is highlighted for 3 s.
- Need page: if the item gets funded while the donor is only looking, the status view replaces the donate panel. Once a
  payment has started, the panel stays locked to what the donor chose (C-3).

## Big-screen mode

`/o/:slug?display=1`: no site header, filters or tabs. The charity's name, "Raised so far", a QR code to the plain
tile wall URL (no `display=1`), and big tiles: still needed first (most urgent), then the 8 most recently funded.

- A tile that just got funded stays in its place for 8 s (bar fills up and turns green, a soft pulse), then joins the
  funded ones. The bottom ticker shows "Just now · … is fully funded. Thank you, 6 donors!" for 15 s.
- Overflowing tiles scroll slowly down and back up, pausing 5 s at each end (off with reduced motion; the wall can then
  be scrolled by hand). No scrollbar is shown.
- Designed for 1920×1080. All sizes are in rem and the root font size follows the screen, so 1280×720 and 4K look the
  same, just scaled.
- The screen is kept awake (Screen Wake Lock) where the browser supports it.

## Mock mode (`VITE_USE_MOCKS=true`)

There is no stream to connect to: `useOrgStream` subscribes to the mock API's in-page feed instead
(`mockDb.subscribeNeedUpdates`). Every mock change to a card sends `need.updated`: a hold (create order), a capture,
a publish, a staff edit. Mock state lives in one tab, so mock live updates only reach screens in that tab.

### Pretend donor: `?mock=liveDemo`

Add `mock=liveDemo` to any page URL (it's read when the page loads). Every 4 s a random Harbor Food Bank tile that still
takes money gets a $5–$20 gift through the same mock create-order → capture path a donor uses (the server clamps it to
what's left). It stops once nothing at Harbor has money left to raise.

- Big screen: `http://localhost:5173/o/harbor-food-bank?display=1&mock=liveDemo`
- Tile wall: `http://localhost:5173/o/harbor-food-bank?mock=liveDemo`
- Staff console: sign in, then open `http://localhost:5173/staff?mock=liveDemo`

Reload the page to start over (mock data resets with the tab).

## Demo with the real API (the video scene, 0:50–1:30)

Two browsers (or two devices) pointed at the same deployed API:

1. Big screen: open `/o/harbor-food-bank?display=1` full screen (F11).
2. Phone: scan the QR code on the big screen, open "Diapers, size 4", pay with the PayPal sandbox buyer.
3. The big screen's bar moves when the PayPal window opens (the hold) and fills when the payment is confirmed; the ticker
   says it's fully funded.

Known limitation: if the API answers the stream with an error status (for example a 502 from Render during a deploy),
browsers give up on that `EventSource` and the page stops updating until it is reloaded. Reload the big screen after
every API deploy.
