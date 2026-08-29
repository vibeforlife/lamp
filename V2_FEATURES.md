# Magic Lamp V2 — Feature Bundle

This build starts from the frozen V1 baseline and adds the V2 feature layer.

## Included
- Shared Circle Summon History (All / My History)
- Magic rewards for accepted summons
- Difficulty tiers: Easy 5, Medium 10, Hard 25, Epic 50 Magic
- Genie levels and progress
- Achievement badges
- Answer streaks and best streak
- Circle leaderboard / Genie stats
- Surprise Genie selection
- Acceptance magic moment / visual spectacle
- Idempotent reward ledger
- Existing First Genie Wins and Everyone Responds behavior
- Existing async-button safeguards

## Deliberately not included in this bundle
- Durable scheduled summons
- Recurring summons
- Durable deferred-response reminders

Those require a server-side scheduling/notification design and are intentionally deferred rather than simulated in the browser.

## Validation status
- Frontend JavaScript syntax: passed.
- TypeScript transpile/syntax validation: passed.
- Full `npm run build`: not run successfully in this isolated environment because npm dependency installation could not complete.
- Full `npm run lint`: not run successfully in this isolated environment because the dependency installation could not complete.

Run `npm install`, `npm run build`, and `npm run lint` on the development Mac before treating this as a validated release candidate.

- Live sender updates for summon responses and completion.
- Invite-link copy feedback.
- Clear day-streak wording.