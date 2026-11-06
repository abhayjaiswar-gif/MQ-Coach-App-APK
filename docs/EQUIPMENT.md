# Equipment (MyApp, API 4000)

## Mobile flow
One More > Equipment tile. Every screen is registered in the shared nested tab stacks.
- **See stock:** latest count for each item + size, usable/damaged/missing, dated source record, searchable list and paged activity. No rows means **Not counted yet**, not zero.
- **Received items:** approved request or other receipt > choose/name item and size > quantity > review > confirm. Partial request receipts are supported.
- **Give out / Return:** student/team/coach picker, usable-stock validation, outstanding-loan picker, partial returns and damaged-return count > review.
- **Report a problem:** Damaged confirms directly; Missing goes through SSGM then Admin. Missing can be school stock or a loan. A missing loan closes only after approval and is never deducted from school stock twice.
- **Request more:** new request > item/size/quantity, optional reference photo (authenticated XHR) > review. Timeline Requested > SSGM checked > Admin approved > Received. Legacy photo-only requests remain visible, with full-screen reference-photo viewing.
School, author and recorded time are automatic; displayed timestamps use IST. Main screens retain the tab bar. Existing live palettes provide light/dark styling.

## Counting rules
`quantity` is physical stock at school including damaged; `usable = quantity - damaged`. An issue temporarily reduces physical stock; a return adds it back. Damage moves usable to damaged without changing physical count. Approved missing school stock reduces usable and physical count; approved missing loans settle the loan only. Confirmed Missing is an all-time ledger total, separate from physical count.
Use the most recent item/size row no later than the current IST month. Never sum months. Ties from duplicate legacy sizes use the highest variant ID. On the first movement of a month, copy each size's latest applicable snapshot before applying the change. Historical rows are not rewritten. No historical counts are reinterpreted or bulk migrated.
Opening counts/corrections remain in web School Inventory; do not enter already-owned opening stock as a new delivery. Existing web annual-sum reports/transfers retain their old semantics and are not used as mobile current stock.

## Database and atomicity
Additive, rerunnable `server/migrations/inventory_movements.sql` creates:
- `inventory_movements`: immutable action details, borrower/team, order/loan links, authenticated author, before/after counts, approval state and timestamps.
- `inventory_school_locks`: school-level transaction mutex. An exclusive upsert avoids INSERT IGNORE/shared-lock upgrade deadlocks.
- `inventory_request_batches`: retry-safe multi-item requests.
Movement and count update commit in the same InnoDB transaction. Unique (school, idempotency_key) plus request hash makes identical retries safe; changed payload with the same key returns 409. Competing issues cannot oversell; returns cannot exceed the outstanding loan; receipts cannot exceed approved requested quantities. Native forms retain their key on retry and guard rapid double taps. No offline outbox is implemented.

## APIs and shared web tables
Authenticated JWT identity/DB role is authoritative; supplied user_id/role_id cannot grant access. Head coach and stock managers can write within their schools; SSGM/Admin approval is enforced server-side.
- GET `/api/school-inventory/schools`, `/:schoolId`, `/:schoolId/years`
- POST `/:schoolId/equipments`, `/equipment/:id/variants` (single or web-compatible array)
- PUT `/api/school-inventory/equipment/:id`; existing variant IDs are updated, not recreated. Omitted variants are left alone. Explicit variant lists synchronize additions/removals. Ledger-linked variants cannot be deleted.
- DELETE equipment/variant routes for unreferenced records
- GET/POST `/api/equipment-orders`; optional multipart `image`, `items` array, shared `equipment_order` approval/delivery fields, image-only legacy support
- PUT `/api/equipment-orders/:id/status` for scoped SSGM/Admin
- GET `/api/equipment/current`, `/recipients`, `/loans`, `/movements` (`school_id`; movement pagination via `before`)
- POST `/api/equipment/movements` and `/movements/:id/retry`
Shared counts are written to `school_inventory_equipments` / `school_inventory_equipment_variants`, so the existing web inventory sees the same rows. Legacy stock-report spreadsheets and annual transfers are not added to the mobile flow.

## Missing approvals
Missing reports create clearly labelled `[MISSING - approval only]` or `[MISSING LOAN - approval only]` shared equipment_order rows, linked to the ledger. They are not purchase receipts. Existing web SSGM/Admin screens can review those rows without a web code change. A 4000 worker checks the same flags every 15 seconds and applies each approved loss once; 4000 approvals reconcile immediately. Rejections do not change counts. If stock/loan availability changed before approval, the report becomes Needs stock check, with an explicit Recheck action. API 4000 must stay running for web-only approvals to reconcile.
New Equipment routes are data-only: no email or push sending is added. Existing web notifications/approval UI are not changed.

## Verification
- `node server/tools/test_equipment.cjs`: designated real head-coach test login 938 on port 4000, school 2; random temporary item prefix, approval simulation changes **only the test's own order rows**; finally cleans its ledger, request batches/orders, inventory rows, images and session. Never prints credentials/tokens.
- `node tools/test_equipment_ui.cjs`: mocked hook/render smoke tests (not a native emulator), stepper payloads, review/retry, people/loan pickers, photo, missing-loan, empty state, timeline, named exports and one tile/tab-stack wiring.
- `node tools/test_match_ui.cjs` and `node server/tools/test_match_reports.cjs`: existing feature regressions; missing existing Match API exports/server mount were restored while integrating Equipment.
- `npx expo export:embed --platform android --dev false --bundle-output <TEMP>/mq-equipment.bundle --entry-file index.js`

Not a signed APK or an iOS/device test. Web direct edits do not produce ledger history; their existing annual aggregation and direct-update behavior are outside this additive feature. No live SSGM/Admin account or real delivery/notification was used in tests. Existing unrelated server startup warnings (missing Firebase key and achievement_social.sql) were not changed.
