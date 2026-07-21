# Push scheduling

Notifications leave this app through two independent paths. Understanding
which path carries what is the whole of operating it.

| Path | Carries | Triggered by | Precision |
| --- | --- | --- | --- |
| **Exact** | Queued notifications (snooze, proactive nudges) | QStash calls back `POST /api/push/drain` at the queued instant | seconds |
| **Periodic** | Daily briefing, event reminders, missed queue rows | External cron, hourly | the hour |

The split exists because the two have different requirements. A briefing only
needs to know which local hour it is. A "remind me in 10 minutes" needs to land
at ten minutes — and polling a serverless Postgres every few minutes to achieve
that wakes the database thousands of times a day to find nothing to do.

## Why not Vercel cron

Vercel evaluates cron expressions in UTC only, its Hobby tier allows two jobs
at daily frequency, and no tier can express "call me at this one instant". The
endpoints authenticate with `CRON_SECRET` via `Authorization: Bearer` or
`?secret=`, so any HTTP scheduler drives them — nothing is Vercel-specific.

## Environment

```
CRON_SECRET=<random string>       # required in production; gates every endpoint below
QSTASH_TOKEN=<from Upstash>       # optional; without it, queued items fall back to the sweep
APP_URL=https://your-app.example  # optional; defaults to NEXTAUTH_URL
```

`APP_URL` is the origin QStash calls back into. Scheduling is skipped entirely
when it resolves to localhost, since Upstash cannot reach a dev machine — local
queued notifications simply wait for the sweep.

## External cron jobs

Four jobs, all `GET`, all with header `Authorization: Bearer $CRON_SECRET`.
[cron-job.org](https://cron-job.org) is enough; so is any scheduler that can
send a header.

| Endpoint | Schedule | Purpose |
| --- | --- | --- |
| `/api/push/scheduled` | `0 * * * *` | Daily briefing **dispatcher**. Runs hourly and selects only users whose local hour matches their `briefing_hour` — how one UTC schedule serves every timezone — then fans the per-user work out (see below). |
| `/api/push/event-reminders` | `0 * * * *` | "Starting soon" reminders. The 60-minute match band is tied to this hourly cadence — see the constants in the route before changing it. |
| `/api/push/drain` | `0 * * * *` | Safety net only: delivers rows QStash never took, and reclaims deliveries that died mid-flight. |
| `/api/push/retrospective` | `0 * * * 6,0,1` | Weekly look back at the past seven days. Filters on local *day* as well as local hour. The Saturday/Sunday/Monday schedule is not padding: somebody's local Sunday starts Saturday 10:00 UTC (UTC+14) and ends Monday 12:00 UTC (UTC-12), so a Sunday-only schedule skips users at both edges of the map. |

Hourly is deliberate for `drain`. It is not the delivery mechanism; making it
more frequent buys nothing once QStash is configured.

## Briefing fan-out

`/api/push/scheduled` is a dispatcher, not a worker. It runs a cheap in-memory
gate (`isBriefingDue`, off the cached `timezone`) over every subscriber and does
no per-user I/O for the ~95% who aren't in their briefing window this hour. Each
survivor is published as one QStash message to `POST /api/push/briefing-user`,
which does that user's calendar fetch, LLM briefing, send, and insight queuing
in its own short invocation. This is what keeps thousands of users off a single
60-second budget; the atomic dedupe claim inside the worker makes a doubled
dispatch or a QStash retry idempotent.

`briefing-user` is driven by QStash, not cron — it takes `{ userId }` and
authenticates with the same forwarded `CRON_SECRET`. Without QStash configured
(local dev, or a failed publish) the dispatcher falls back to running users
inline, bounded, so small deployments still work; large ones must set
`QSTASH_TOKEN`.

## Cutover

`vercel.json` still declares its crons. Leave it until the external jobs have
actually fired once — removing it first stops briefings and reminders with
nothing yet replacing them. Once the external scheduler shows successful runs,
delete the `crons` key.

Running both briefly is safe: every scheduled sender claims a dedupe key
(`sent_notifications`) or an atomic queue-row transition before it sends, so a
doubled trigger produces one notification, not two.

## Delivery guarantees

- **The queue row is the source of truth.** It is written before QStash is told,
  so a failed publish costs precision, never the notification.
- **Rows are claimed atomically** (`pending` → `sending`), so the QStash
  callback and the sweep cannot both deliver one row.
- **Interrupted deliveries recover.** A row left in `sending` past
  `reclaimStaleDeliveries`' timeout returns to `pending` on the next sweep;
  staleness is measured from `claimed_at`, not from when the row was queued.
- **Cancelled work stays cancelled.** Deleting a pending row is enough — a
  QStash callback that finds no row no-ops, so the message needs no cancelling
  upstream.
