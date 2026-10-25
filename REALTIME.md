# Live updates

Admin panel and mobile app now refresh on their own when data changes.

## How it works
- **Server** (`lykasServer/src/utils/realtime.js`): a global Mongoose plugin watches every
  model write (save / update / delete / insertMany) and emits a small
  `data:changed` Socket.IO event: `{ resource, action, ids, at }`. No record data is sent;
  clients refetch through the normal REST API, so auth/permissions are unchanged.
  - Staff sockets join `staff_room` and get every event (with ids).
  - Everyone joins their own `<userId>` room and gets events for documents that name them
    (`applicant`, `user`, `recipient`, `submittedBy`, `fosterer`, `donatedBy`, `paidBy`,
    `owner`, `assignedTo`) — without ids.
  - `Pet`, `Event`, `Announcement`, `ContentItem` are broadcast to all connected clients.
  - Bursts are coalesced for 250 ms (`REALTIME_FLUSH_MS`). High-volume models
    (`ApiLog`, `Session`, `Message`, ...) are ignored — chat keeps its own `receiveMessage`.
- **Admin** (`src/context/RealtimeContext.tsx`): one shared socket. `useResourceList`
  (backs ~25 pages) subscribes automatically based on its endpoint
  (`src/services/realtimeResources.ts`) and refetches silently. Dashboard, Analytics,
  Application details, Cage management and Health also refresh live; the navbar bell is
  pushed instead of polled (5-minute fallback) and shows a green "live" dot.
- **Mobile** (`context/RealtimeContext.tsx`): one shared socket for the app, catching up
  after a reconnect or when returning to the foreground. Screens use
  `useSilentFlag()` + `useRealtimeReload(resources, load, flag)`. The signed-in user's own
  account also refreshes when it changes server-side.

## Adding live refresh to another screen
```tsx
const live = useSilentFlag();
const load = useCallback(async () => {
  const silent = live.take();
  if (!silent) { setLoading(true); setError(null); }
  try { /* fetch */ } catch (e) { if (!silent) setError(...); } finally { setLoading(false); }
}, [live]);
useRealtimeReload(["ModelName"], load, live);   // Mongoose model names
```
Admin pages without `useResourceList`: `useRealtime(["ModelName"], refetch)`.

## Notes
- Single server instance assumed. Running several needs the Socket.IO Redis adapter
  (the project already has `config/redis.js`).
- Writes that bypass Mongoose (`bulkWrite`, raw driver calls) don't emit.
- `updateMany`/`deleteMany` can only target owners named in their filter; otherwise only
  staff are notified (users see it on next focus/foreground).
- Admin Pet Management's edit panel is deliberately not live-refreshed so it can't
  overwrite unsaved edits; its list is live.
