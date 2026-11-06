# Match Reports

The web MatchReportPage.vue is an upload registry, not a structured match editor.
It lists school-scoped rows and uploads an existing PDF with school_id/user_id.
It does not generate a PDF, offer team scores, or have an edit/detail screen.

## Mobile extension

- Legacy GET/POST /api/match-reports supported; original PDF bytes are preserved.
- Structured match metadata goes into additive app_match_report_details, keyed by report_id.
- match_report_card is not altered. Its required match_date is supplied (web handler omitted it).
- Only identity from the bearer token is trusted, with DB role/school scope checks.
- Author/admin can edit. Team/player IDs must belong to the chosen school.
- GET /api/match-reports/options?school_id supplies teams and active students.
- POST /api/match-reports/:id/edit and PUT /api/match-reports/:id save multipart.
- PDF links require a 5-minute signed token and recheck school scope.
- Original PDFs are byte-identical; native scorecards use a new pdf-lib template.
- Native PDF embeds JPEG/PNG photos; WebP appears in app but is omitted from generated PDF.
- Uploaded files: 10 MB per file; up to 6 photos, JPEG/PNG/WebP only.
- Files removed/replaced in the app are retained on disk to avoid deleting shared web assets.
- Native scorecards are materialized into file_path too, so the web registry can open them.

## Test

Run node tools/test_match_reports.cjs from server with MyApp on 4000.
Uses Desktop/mq-test-headcoach-login.txt locally without logging credentials.
The test logs in as 938, exercises CRUD, photos, scope and signed PDFs, then removes
only its own rows, metadata and files and logs out.
