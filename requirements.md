# Chronos — Smart Timetable Generator
## End-to-End Project Context & Source of Truth
**Prepared:** 11 October 2026  
**Purpose:** Consolidate the project's goals, requirements, architecture, constraints, design direction, MVP scope, and planned deliverables so development can continue without losing prior decisions.

---

## 1. Project identity

**Project name:** Chronos — Smart Timetable Generator  
**Product category:** University / institute academic scheduling and timetable management platform.

### Product vision
Build a reliable, university-wide platform that transforms academic data and scheduling rules into valid, optimized timetables. It should replace fragile, time-consuming spreadsheet-based manual scheduling while preserving the ability for academic staff to review, edit, lock, approve, publish, and export schedules.

This is not merely a timetable grid UI or an LLM chatbot. The core product is a structured academic scheduling system backed by a deterministic constraint-solving engine, independent validation, and safe editing workflows.

### Primary outcome
Given valid academic data and institutional constraints, generate a complete timetable that satisfies all hard constraints, explain infeasibility or conflicts when no valid schedule can be found, and produce practical schedules for divisions/students, faculty, rooms, and departments.

---

## 2. Problem being solved

Manual timetable creation is difficult because the same resources are shared across many activities:
- Faculty teach multiple subjects, divisions, and semesters.
- Divisions and student groups cannot attend two sessions at once.
- Rooms and laboratories have limited availability, capacity, and facilities.
- Laboratory sessions may require consecutive periods.
- Some sessions, electives, shared lectures, auditoriums, or special activities involve multiple divisions or shared resources.
- Faculty workload and required weekly subject hours must be satisfied.
- Fixed events, breaks, library/project periods, and working-hour rules restrict placements.
- A change in one part of a timetable can create cascading conflicts elsewhere.
- Spreadsheet inputs may be inconsistent, duplicated, incomplete, or use different labels for the same entity.

The platform must model these relationships explicitly rather than relying on manual checking.

---

## 3. Product principles

1. **Correctness before visual polish:** a timetable must pass independent validation.
2. **Hard constraints are non-negotiable:** never silently publish a schedule with hard conflicts.
3. **Explainability:** when generation fails, identify the relevant missing data, impossible constraints, or conflict causes as clearly as possible.
4. **Safe editing:** manual changes must be validated before they are accepted.
5. **Lock-and-regenerate:** preserve explicitly locked sessions while regenerating the remaining schedule where feasible.
6. **Structured data:** import spreadsheets into a normalized domain model; do not use raw spreadsheet cell positions as the application's data model.
7. **Deterministic scheduling:** use a constraint solver for placements. An LLM may help with natural-language explanations or assisted data cleanup, but it must not be the authority that decides whether placements are valid.
8. **Incremental rollout:** prove the system on a narrow department/semester MVP before scaling university-wide.
9. **Excel compatibility:** spreadsheet import/export is a core workflow, not an afterthought.
10. **Role-based access:** users should only perform actions allowed by their institutional role and scope.

---

## 4. Users and roles

The role model discussed so far includes:

- **Super Admin:** platform-level administration across institutions.
- **Institute / University Admin:** manages institution-level configuration and academic structure.
- **Academic Admin:** manages academic setup and operational scheduling data within its authorized scope.
- **HOD:** manages or reviews department schedules, data, and approvals within the department.
- **Faculty:** views assigned schedules and, in later workflows, participates in authorized availability, schedule-change, or proxy processes.
- **Student:** views their division/group timetable, room/location, and published changes.

Earlier role descriptions sometimes used “Institute Admin” and “University Admin”; the final implementation should establish one canonical role name for each permission level and document any institution-specific variation. The MVP should not overbuild the complete multi-tenant permission system before the core scheduling workflow is proven, but its data model should not block it.

### Role-based access control (RBAC)
A planned deliverable is a permission matrix defining which roles may:
- View and edit institutional structure.
- Import and validate data.
- Generate schedules.
- Lock or unlock sessions.
- Edit individual placements.
- Approve and publish schedules.
- Export schedules.
- Manage faculty, rooms, subjects, and availability.
- View audit history and conflict reports.

Every write operation should enforce permissions in the backend, not only hide buttons in the UI.

---

## 5. Academic hierarchy and domain model

The long-term hierarchy discussed is:

**Platform → Institute/University → Department → Program/Course → Branch → Semester → Division/Section → Faculty/Students and scheduled activities**

The exact institutional terminology should be configurable or mapped during import because colleges may use “program,” “course,” “branch,” “section,” and “division” differently.

### Main entities to model
- Institution / Institute
- Department
- Academic year and academic term
- Semester and semester type (ODD / EVEN)
- Program / course and branch
- Division / section
- Student group / batch, where needed
- Subject / course unit, including course code
- Subject offering for a specific term, semester, division, and group
- Faculty member
- Faculty-subject assignment
- Faculty availability and unavailability
- Room / classroom / laboratory / auditorium
- Room capacity, type, and facilities
- Working day and time slot
- Break / non-teaching period
- Teaching requirement and required weekly sessions/hours
- Scheduled activity / session
- Fixed or shared session
- Elective and elective group
- Existing timetable / imported placement
- Academic calendar and special dates
- Scheduling constraint and optimization preference
- Generation run and its input/version metadata
- Conflict / validation finding
- Session lock
- Approval / publication state
- Audit event

Use stable canonical IDs for entities and relationships. Names and display labels are not reliable keys.

---

## 6. MVP scope — agreed direction

The MVP should be deliberately narrow:

- One college/university.
- One department.
- One program.
- One selected semester.
- Multiple divisions within that scope.
- Select **ODD or EVEN** before choosing/generating the target semester.
- Upload a standardized Excel workbook.
- Validate the input and show actionable errors.
- Generate a timetable automatically.
- Independently validate the result.
- Edit sessions manually with conflict checks.
- Lock selected sessions and regenerate the rest while preserving those locked sessions.
- Export the final timetable to Excel and PDF.

The initial goal is to reproduce the real scheduling behavior represented by the university's existing spreadsheets, not to support every possible institution-specific rule on day one.

### MVP workflow
1. Create/select the institution and department scope.
2. Choose semester type: ODD or EVEN.
3. Select the matching semester and academic term.
4. Upload the standardized workbook.
5. Parse the workbook and map rows to canonical entities.
6. Validate required fields, IDs, references, and consistency.
7. Show errors and warnings; let the user correct data and re-upload or edit where supported.
8. Configure/confirm hard constraints and preferences.
9. Run the solver asynchronously if needed.
10. Display generation status and any infeasibility explanation.
11. Run an independent validator on the generated result.
12. Show the timetable draft and any validation findings.
13. Let authorized users edit, lock, or regenerate.
14. Revalidate after each accepted change or generation run.
15. Review and approve the schedule.
16. Publish it and export Excel/PDF.
17. Preserve version history and audit important changes.

---

## 7. Existing data and spreadsheet context

Prior discussion referenced four Indus University timetable Excel workbooks, covering ODD/EVEN 2026 and EVEN 2025, including division-grid and master-data-style files. These are the initial reference data sources for understanding the current timetable format and the real constraints. Their contents should be inspected directly before implementing any assumptions about column names, period timing, or scheduling rules.

### Universal Excel workbook
The planned universal workbook should support, at minimum:
- Institution and academic hierarchy.
- Academic year, term, semester, and ODD/EVEN type.
- Subjects and course codes.
- Weekly lecture/lab/practical requirements.
- Faculty and faculty-subject mappings.
- Faculty availability/unavailability.
- Divisions, sections, batches, and student groups.
- Rooms, labs, capacities, and facilities.
- Working days and time slots.
- Breaks and non-teaching periods.
- Fixed sessions and shared resources.
- Electives and linked groups.
- Existing timetable placements, where applicable.
- Hard constraints and soft preferences.
- Special sessions such as PROJECT, LIBRARY, or other institution-specific activities.

### Workbook design principles
- Machine-first rows and columns, not decorative layouts.
- Stable unique IDs for entities.
- Separate sheets for distinct entities and relationships.
- Explicit references between sheets.
- Clear required/optional fields and allowed values.
- A template version and schema version.
- Data validation where practical.
- Avoid using display names as the only join key.
- Return row/sheet/field-level import errors so users can correct data.

### Import validation categories
- Missing required fields.
- Duplicate IDs.
- Unknown foreign-key references.
- Invalid semester or division mappings.
- Invalid time-slot definitions.
- Impossible or contradictory availability.
- Missing subject/faculty assignment.
- Weekly requirements that cannot be reconciled.
- Room type/capacity mismatches.
- Overlapping fixed sessions.
- Incomplete shared-session/elective relationships.

A universal template is the longer-term goal; the MVP may use a focused department-and-semester template as long as it follows the same underlying schema principles.

---

## 8. Scheduling engine

### Core decision
Use a deterministic constraint programming approach. **Google OR-Tools CP-SAT** was the proposed solver.

The solver should choose valid placements for sessions while satisfying hard constraints and optimizing soft preferences. Do not ask an LLM to invent the final timetable.

### Suggested model structure
Represent each required teaching activity as one or more schedulable sessions. Each session should include:
- Subject/offering.
- Required division, section, batch, or linked groups.
- Required faculty or eligible faculty set.
- Activity type (lecture, lab, practical, elective, project, etc.).
- Duration in periods or minutes.
- Eligible rooms or room requirements.
- Required weekly frequency.
- Availability restrictions.
- Fixed/locked status.
- Shared-resource relationships.
- Relevant hard constraints and soft preferences.

The solver then assigns each session a compatible time, room, and faculty arrangement where those are decision variables.

### Hard constraints discussed
At minimum:
- No faculty member is assigned to overlapping sessions.
- No division, section, or student group has overlapping sessions.
- No room is used by overlapping sessions.
- Room capacity must be adequate where capacity is applicable.
- Room type and facilities must satisfy the activity (e.g., laboratory requirements).
- Faculty and room availability must be respected.
- Sessions must fit within allowed working days and time slots.
- Required weekly subject/session hours must be fulfilled.
- Labs requiring consecutive periods must receive contiguous slots.
- Fixed sessions must remain at their specified time/resources.
- Shared sessions and shared resources must be modeled without double-booking.
- Breaks and blocked periods cannot receive ordinary teaching sessions.
- Locked sessions must be preserved during regeneration unless an authorized user explicitly unlocks them.
- Special activities such as PROJECT or LIBRARY must follow their configured rules.

The exact hard-constraint list must be verified against the actual university workbooks and academic rules. Do not assume every institution has the same requirements.

### Soft constraints / optimization objectives
Potential objectives discussed:
- Distribute repeated subject sessions sensibly across the week.
- Avoid undesirable gaps for students and faculty.
- Avoid excessive consecutive teaching periods where practical.
- Balance faculty workload across days.
- Prefer appropriate rooms and reduce unnecessary room changes.
- Avoid undesirable subject clustering (a previously noted concern).
- Respect preferred time slots when feasible.
- Reduce timetable fragmentation.
- Minimize disruption when regenerating around locked sessions.

Soft constraints must never override hard constraints. The UI should distinguish “valid but not ideal” from “invalid.”

### Infeasibility and conflict explanations
When no solution is found, do not just show “generation failed.” Report the most useful diagnosis available, such as:
- Missing or contradictory input data.
- A session has no eligible faculty/room/time.
- Too many required sessions for available periods.
- A fixed session conflicts with another fixed session.
- A lab duration cannot fit in the available consecutive slots.
- A locked timetable leaves insufficient capacity for remaining sessions.

CP-SAT may not always produce a perfect human-readable minimal explanation automatically. Build diagnostics and pre-checks around the solver, and be explicit about whether a message is a proven cause or a likely contributing factor.

---

## 9. Independent timetable validator

The validator is separate from the solver and checks the final placements against the canonical data and rules. It should not simply trust the solver output or reuse the exact same unverified assumptions.

### Validation checks
- Faculty clashes.
- Division/group clashes.
- Room clashes.
- Availability violations.
- Invalid room type or capacity.
- Missing or extra required sessions.
- Incorrect session durations.
- Non-consecutive lab periods where consecutiveness is required.
- Placement during breaks or blocked periods.
- Fixed/locked-session changes.
- Shared-session relationship errors.
- Subject clustering or other soft-rule scoring.
- Invalid references or orphaned sessions.

The validator should produce structured findings with severity, affected entities, day/time, rule identifier, and suggested correction where possible.

**A schedule should not be marked publish-ready if it has unresolved hard-constraint violations.**

---

## 10. Manual editing, locking, and regeneration

Manual editing is a core requirement, not a later cosmetic feature.

### Editing
Authorized users should be able to move a session to another time or room, change an allowed assignment, and see the result of validation before committing. Conflicts should be shown in context.

### Locking
A user should be able to lock a placement that must not move during subsequent generation. Locks should be explicit records with the user, timestamp, and reason where useful.

### Regeneration
Regeneration should:
1. Load the current timetable and its version.
2. Preserve locked sessions as fixed assignments.
3. Apply new constraints or requested changes.
4. Solve for the remaining eligible sessions.
5. Validate the result independently.
6. Show a preview/diff before replacing the prior draft.
7. Keep the previous version available for recovery/audit.

If the remaining problem becomes infeasible, retain the previous valid timetable and explain the failure instead of silently damaging the schedule.

---

## 11. Proposed technical architecture

The previously discussed direction was:

| Layer | Direction |
|---|---|
| Web frontend | React |
| Mobile app | React Native |
| Backend API | FastAPI |
| Main database | PostgreSQL |
| Constraint solver | Google OR-Tools CP-SAT |
| Background jobs | Redis + worker process |
| Packaging/deployment | Docker-based infrastructure |
| File handling | Workbook import/export; object storage can be added for production |
| Operations | Monitoring, backups, structured logs, and job status tracking |

This is the established direction from prior discussions, not a claim that every component has already been implemented.

### Logical architecture
```text
Web App / Mobile App
        |
        v
FastAPI Backend + Authentication + RBAC
        |
        +---- PostgreSQL (normalized academic data, schedules, versions)
        |
        +---- Import/Export service
        |
        +---- Background job queue (Redis)
                       |
                       v
                 Scheduling worker
                 OR-Tools CP-SAT
                       |
                       v
              Independent validator
                       |
                       v
             Draft/versioned timetable
```

### Backend responsibilities
- Authentication and authorization.
- Institution/department/term setup.
- CRUD for academic entities.
- Workbook upload, parsing, validation, and import.
- Constraint configuration.
- Generation job creation and status.
- Solver invocation and result persistence.
- Independent validation.
- Safe manual edit and lock/unlock operations.
- Timetable versioning, approval, publication, and audit.
- Excel/PDF exports.
- Notifications for relevant schedule changes.

### Database principles
- Use normalized relational tables for canonical academic data.
- Enforce foreign keys and unique constraints.
- Store generation runs and their input versions.
- Store schedule versions/drafts separately or with a robust versioning design.
- Track session locks and audit events.
- Store constraint configuration explicitly rather than burying it in UI-only logic.
- Add indexes based on actual query patterns.
- Scope all institution-owned records correctly to avoid cross-institution data leakage as the system expands.

The exact PostgreSQL schema remains a planned deliverable and should be created from the domain model and workbook analysis, not guessed independently of the data.

---

## 12. APIs and background processing

A REST API specification was planned. Likely resource areas include:
- Authentication and current-user context.
- Institutions and academic structure.
- Academic years, terms, and semesters.
- Subjects and offerings.
- Faculty, assignments, and availability.
- Divisions, batches, and student groups.
- Rooms and resources.
- Time slots and calendars.
- Workbook upload/import jobs.
- Validation reports.
- Generation jobs and job status.
- Timetable drafts, sessions, and versions.
- Lock/unlock operations.
- Manual edits and conflict previews.
- Approval and publication.
- Exports and notifications.

Long-running timetable generation should be handled as a background job rather than keeping an HTTP request open. The client should be able to poll or subscribe to job status and retrieve structured results.

API names, payloads, status codes, and authorization rules still need a formal specification.

---

## 13. UI/UX direction

The desired product is premium, calm, professional, and optimized for dense academic information—not a generic AI dashboard.

### Visual direction
A concept called **“The Register”** was discussed:
- Warm paper/ivory background.
- Forest green `#0F2318`.
- Leaf green `#1E5C3A`.
- Restrained, readable typography.
- Clear grid hierarchy and generous spacing.
- Strong legibility for timetable cells.
- Practical layouts that work at realistic university data density.

Earlier notes also describe avoiding blue/purple/orange gradients, glassmorphism, and overdecorated dashboard patterns. Keep the visual system restrained and consistent.

### Key screens planned
1. Sign-in and role-aware landing page.
2. Institution/department/semester setup.
3. Academic data overview.
4. Workbook upload and template download.
5. Import mapping and validation report.
6. Semester and division selection.
7. Scheduling constraints/preferences.
8. Generation job progress and result summary.
9. Timetable grid/editor.
10. Conflict details and explanations.
11. Lock/unlock and regenerate workflow.
12. Faculty timetable.
13. Room timetable.
14. Division/student timetable.
15. Approval and publish flow.
16. Export center.
17. Audit/version history.
18. Admin management screens.

### Timetable grid usability
- Clear days and period/time labels.
- Subject, faculty, room, and activity type visible without opening every cell.
- Distinct but restrained visual treatment for lectures, labs, fixed sessions, and blocked periods.
- Responsive behavior and accessible contrast.
- Fast navigation between divisions and views.
- Clear conflict indicators and keyboard/mouse-friendly editing where practical.
- Never rely on color alone to communicate a conflict.

---

## 14. Mobile application direction

React Native was the discussed mobile direction. Mobile is primarily for convenient access to published schedules and schedule changes; complex timetable administration can remain web-first initially.

### Student
- View published division/group timetable.
- See room/location.
- Receive schedule-change notifications.
- View the current day/week.

### Faculty
- View teaching schedule.
- See room and division details.
- Receive timetable-change notifications.
- Later, support authorized proxy or schedule-change workflows.

Offline access and notification behavior were listed as part of the mobile specification deliverable. Exact offline caching, push provider, and synchronization policy remain to be designed.

---

## 15. Testing and quality strategy

Testing benchmarks were a planned deliverable.

### Minimum test layers
- Workbook parser tests.
- Schema and foreign-key validation tests.
- Unit tests for each hard constraint.
- Solver tests using small known-feasible and known-infeasible examples.
- Independent validator tests.
- Regression tests using sanitized real timetable inputs.
- Lock-and-regenerate tests.
- Manual-edit conflict tests.
- Export correctness tests.
- RBAC and cross-institution isolation tests.
- API integration tests.
- Performance tests with increasing numbers of divisions, sessions, rooms, and faculty.

### Essential acceptance criteria
- No unresolved hard conflicts in a timetable marked valid/publish-ready.
- Required teaching sessions are neither silently omitted nor duplicated.
- Locked sessions remain unchanged through regeneration.
- Invalid input produces actionable errors tied to sheet/row/field where possible.
- Manual edits cannot silently introduce hard conflicts.
- Exports correspond to the saved timetable version.
- Generation results are traceable to input data, constraints, solver settings, and a generation run ID.
- A failed regeneration does not destroy the previous valid draft.

### Benchmark data
Use the real Indus timetable files as reference fixtures after inspecting and, where needed, sanitizing them. Record input size, solve time, validation results, number of sessions, and quality scores. Do not invent performance targets until representative input sizes and hardware are measured.

---

## 16. Security, reliability, and production readiness

The production plan included Docker, PostgreSQL, Redis, workers, object storage, monitoring, backups, scaling, and deployment. These are architecture requirements to design and stage appropriately, not proof that production infrastructure is already running.

Key requirements:
- Backend-enforced RBAC.
- Secure authentication and session handling.
- Institution-level data isolation.
- File size/type limits and safe workbook parsing.
- Audit logging for imports, edits, locks, approvals, publication, and exports where appropriate.
- Database backups and a tested restoration procedure.
- Monitoring of API errors, worker failures, queue depth, and solver runtime.
- Retry-safe background jobs and idempotent import/generation actions where appropriate.
- Explicit draft/published states.
- Version history and safe rollback.
- Protect uploaded workbooks and exported schedules as institutional data.
- Avoid logging unnecessary student/faculty personal information.

---

## 17. Notifications and change management

Planned notification use cases include:
- A published timetable is available.
- A faculty or room assignment changes.
- A division's schedule changes.
- A session is cancelled or moved.
- A new version is published.

Notifications should be based on meaningful diffs between published versions. Avoid notifying users about internal draft edits that do not affect them. The exact email/push/in-app notification channels remain to be finalized.

---

## 18. Deliverables previously requested, in preferred order

The requested work sequence was:

1. PostgreSQL schema.
2. RBAC matrix.
3. Timetable domain model: courses/offerings/sections/groups/faculty/rooms/resources/time slots/activities.
4. Hard and soft constraints.
5. Solver design and conflict explanations.
6. Universal Excel template.
7. REST API specification.
8. Web screens and workflows.
9. Mobile specification, including offline behavior and notifications.
10. Benchmarks and test strategy.
11. Deployment architecture: Docker, PostgreSQL, Redis, workers, object storage, monitoring, backups, and scaling.
12. Development roadmap.

Presentation/design artifacts also requested:
- Use-case diagram first.
- UML class diagram.
- Activity diagram.
- Sequence diagram.
- Data dictionary.
- UI screenshots/mockups.

---

## 19. Suggested implementation phases

This is an execution structure derived from the agreed scope; it should be adjusted to the actual repository and implementation status.

### Phase 0 — Inspect and define
- Inspect existing code/repository and the real timetable workbooks.
- Document the source workbook structure and academic rules.
- Finalize canonical terminology, IDs, and the MVP scope.
- Build small representative feasible/infeasible test cases.

### Phase 1 — Data foundation
- Design PostgreSQL schema.
- Implement academic entities and relationships.
- Create workbook templates and parser.
- Add import validation with row-level errors.
- Seed the MVP dataset.

### Phase 2 — Scheduling core
- Formalize sessions and constraints.
- Implement CP-SAT model.
- Implement generation job/status tracking.
- Implement independent validator.
- Add solver diagnostics and regression tests.

### Phase 3 — MVP workflow
- Build semester-type selection and data selection.
- Build upload/validation flow.
- Build generation status and result summary.
- Build timetable grid and safe editing.
- Implement lock-and-regenerate.
- Implement Excel/PDF export.

### Phase 4 — Academic review
- Add draft/version history.
- Add HOD review/approval.
- Add publish workflow.
- Add RBAC enforcement and audit logging.

### Phase 5 — Hardening and pilot
- Run against real reference workbooks.
- Fix mismatch between generated output and institutional rules.
- Benchmark solve time and output quality.
- Test backup/restore, permissions, and failure recovery.
- Pilot with one department before expanding.

### Phase 6 — Expand
- Multiple departments/programs/semesters.
- Full institution and multi-institution administration.
- Faculty and room views.
- Student/faculty mobile access.
- Notifications and advanced optimization.
- Additional institutional rules supported through explicit configuration.

---

## 20. Known edge cases to plan for

- Duplicate or inconsistent subject/faculty/room names.
- Faculty assigned to multiple divisions in the same period.
- A subject's required hours not divisible into allowed session lengths.
- Labs requiring consecutive periods across breaks or lunch.
- Fixed events conflicting with each other.
- A division sharing a lecture with another division.
- Electives that create overlapping groups or shared-resource requirements.
- A room that exists but is not suitable for the session.
- A faculty member with insufficient available slots.
- More required sessions than available slots.
- A user editing a timetable while another user is making changes.
- Regeneration with locked sessions that makes the remaining schedule infeasible.
- Semester-type mismatch between the selected semester and uploaded workbook.
- Partial or malformed workbook uploads.
- Timetable exports that do not match the currently published version.
- Solver timeout or worker crash.
- Valid schedule that scores poorly on soft preferences.
- Institution-specific special periods such as PROJECT, LIBRARY, shared auditorium, or IKS.

---

## 21. Decisions vs. items still to verify

### Established direction / previously agreed
- Product is a smart, university-wide timetable generation platform.
- MVP is one institution, one department, one program, one selected semester, multiple divisions.
- ODD/EVEN selection comes before timetable generation.
- Excel upload and validation are core.
- Use deterministic constraint solving, with OR-Tools CP-SAT proposed.
- Use a separate validator.
- Manual edits must be safe.
- Lock-and-regenerate must preserve locked sessions.
- Excel/PDF export is required.
- Technology direction: React, React Native, FastAPI, PostgreSQL, Redis/workers, Docker.
- Design direction: calm, warm, academic, forest-green “The Register” concept.
- UML and data-dictionary artifacts are required, starting with the use-case diagram.

### Must be verified before implementation decisions are treated as final
- Exact source workbook columns, formulas, naming conventions, and data quality.
- Exact timetable days, period lengths, breaks, and allowed time slots.
- Exact weekly subject hours and lecture/lab grouping rules.
- All institutional hard constraints and soft preferences.
- Whether “program,” “course,” “branch,” “division,” “section,” and “batch” map to distinct entities in the target institution.
- Exact role names and approval permissions.
- Exact authentication method and hosting provider.
- Exact API paths and database table definitions.
- Exact mobile offline and notification design.
- Performance targets based on real data and measured hardware.
- Current implementation status and repository structure.

Do not state that planned features are implemented until verified against the actual codebase.

---

## 22. Immediate next step

The next step should be to establish the actual development state, then proceed in the agreed deliverable order without rebuilding already completed work.

1. Inspect the current repository and identify implemented, partial, and missing components.
2. Inspect the four reference timetable workbooks and document their structure.
3. Compare current code and workbook rules against this context.
4. Create a short status matrix: **Done / Partial / Not started / Needs verification**.
5. Continue from the highest-risk gap, typically data normalization, constraints, solver correctness, or independent validation.

---

## 23. One-paragraph project brief

Chronos is a university timetable generation and academic scheduling platform that imports structured academic data from Excel, validates it, and uses a deterministic constraint solver to generate optimized timetables for divisions, faculty, and rooms. Its initial MVP targets one institution, one department, one program, one selected ODD/EVEN semester, and multiple divisions. It must enforce faculty, division, room, availability, capacity, consecutive-lab, fixed-session, and other institution-specific constraints; independently validate every generated schedule; explain failures; support safe manual edits and lock-and-regenerate; and export approved schedules to Excel and PDF. The planned stack is React, React Native, FastAPI, PostgreSQL, OR-Tools CP-SAT, Redis-backed workers, and Docker. The long-term goal is a secure, role-based platform that can expand from one department to a full university and provide published timetable access and change notifications to students and faculty.

---