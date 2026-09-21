# Data Scale and Storage Consistency QA Report

## Scope

- R10: bounded cursor pagination for dashboard, `/link list`, and `/link admin user`
- R11: user-scoped existing-link reuse lookup
- R12: composite Watch uniqueness and conflict-safe registration

## Verification

| Check | Result |
| --- | --- |
| Cursor boundaries: 0, 1, 1,000, 1,001, 2,000, 2,001 links | PASS |
| Missing/repeated cursor, page budget, and later-page failure | PASS |
| Dashboard partial-range labeling and click aggregation basis | PASS |
| Existing-link lookup sends exact URL and user hash together | PASS |
| Existing Watch duplicates are removed before UNIQUE creation | PASS |
| Concurrent LibSQL inserts leave one Watch row | PASS |
| Concurrent service calls return one success and one duplicate | PASS |
| Full Bun test suite | PASS — 204 tests |
| TypeScript typecheck | PASS |
| Production Bun build | PASS |
| Git whitespace validation | PASS |

## Operational Notes

- Personal link catalogs retain at most 2,000 newest owned links and scan at most 20 Sink pages per request.
- When either limit is reached, Discord output explicitly labels the loaded range and its click sum as partial.
- Migration `0001_tan_sir_ram.sql` preserves the oldest row for each guild/channel pair before creating the composite UNIQUE index.

## Result

`QA_PASS`
