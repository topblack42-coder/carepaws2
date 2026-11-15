# CarePaws Admin — Adoption & Foster UI/UX Red-Team Audit

**Project:** `lykasAdmin`  
**Audit scope:** Adoption and Foster workflows  
**Audit method:** Static review of frontend source and relevant server validation. The UI was not launched in a browser.

## Scope and evidence limits

Reviewed adoption applications and details, applicant and identity information, document review, interview and home visit navigation, pipeline progression, risk assessment, decisions, foster placements, weekly reports, extension and closure forms, shared data tables, and modals.

The findings below are supported by code inspection. Responsive rendering, real assistive technology behavior, live loading and error states, and end-to-end red-team scenarios were not exercised in a running browser. Server-side guards were inspected where relevant; their behavior was not executed as part of this audit.

## Findings

| ID | Module | File/component | Severity | Classification | Evidence | Problem | Impact | Recommended fix | Acceptance criteria | Implementation status |
|---|---|---|---|---|---|---|---|---|---|---|
| A-01 | Adoption | `lykasAdmin/src/pages/ApplicationDetails.tsx` | High | Confirmed issue | Application details displayed identity verification as a status field. Document review was a separate route and list. | Staff had no direct document-review route from the application context. | Staff could miss an outstanding or rejected identity document while reviewing an application. | Add an in-context route to document review and, where supported, show document type, review state, and rejection reason on the application. | From an application, staff can open document review; pending and rejected documents and their reasons are easy to locate. | Direct **Review applicant documents** link added. Document state remains in the document-review workflow. |
| A-02 | Adoption | `lykasAdmin/src/components/adoption/DecisionCard.tsx` | High | Confirmed issue | Locked decision buttons used `aria-disabled` and a click guard rather than native disabled controls. | The controls did not expose the locked state through standard disabled semantics. | Keyboard and assistive technology users could have difficulty understanding or operating the decision controls. | Use native disabled controls and associate the visible lock explanation with them. | Before the decision stage, controls are disabled and expose the reason; at the decision stage they are operable. | Implemented with native `disabled` and `aria-describedby`. |
| A-03 | Adoption | `lykasAdmin/src/pages/RiskAssessments.tsx` | High | Confirmed issue | The risk list showed total score, level, and recommendation; individual criteria, red flags, and notes were not available from that list. | The summary obscured the six criteria contributing to the result. Score inputs also defaulted to 3, and notes used a single-line field. | Staff could overlook low-scoring dimensions or make an assessment without intentionally entering every score. | Provide a detail view with six scores, notes, flags, and recommendation. Start scores blank and use a multiline notes field. | Staff can inspect all assessment factors; a new assessment cannot be submitted without supplying every required score. | Implemented in the risk assessment page. |
| A-04 | Adoption | `lykasAdmin/src/pages/Adoptions.tsx` | Medium | Confirmed issue | Application list exposed status and type filters but no stage filter. | Staff could not directly filter the queue by document review, interview, home visit, or risk assessment stage. | Work awaiting a particular workflow step could be harder to find in a large queue. | Add a stage filter and retain visible stage labels on rows. | Each workflow stage can be selected as a filter and returns matching applications. | Stage filter added. Runtime behavior was not tested. |
| F-01 | Foster | `lykasAdmin/src/pages/Fosters.tsx` | High | Confirmed issue | Pending report counts were loaded from `/api/foster/reports/pending-review`; the catch handler swallowed failures. | A failed request appeared like an empty result or left stale counts without an error state. | Staff could overlook reports awaiting review, including reports with health concerns. | Show loading and error states, distinguish unavailable counts from zero, and provide retry. | On request failure the dashboard marks counts unavailable and offers retry; successful retry shows current counts. | Implemented with loading/error indicators and retry. |
| F-02 | Foster | `lykasAdmin/src/pages/Fosters.tsx` | High | Confirmed issue | The placement list showed submitted/required totals, but not overdue report counts or weeks. | The main dashboard did not make overdue reports explicit. | Staff could miss overdue follow-up or need to open every placement to discover overdue weeks. | Show overdue report counts in the placement list and preserve the detailed weekly view. | An active placement with overdue reports is visibly flagged on the dashboard; zero and unavailable states are distinct. | Overdue counts are loaded for visible active placements and shown in the list. Runtime behavior was not tested. |
| F-03 | Foster | `lykasAdmin/src/pages/Fosters.tsx` | High | Confirmed issue | Failure to load `/can-finalize` was silently caught. Report and medical blocker messages depend on readiness data. | A readiness request failure hid the checklist context until a save attempt returned a server error. | Staff could attempt an unsafe or invalid extension or closure without seeing known blockers first. | Show readiness loading and error states, allow retry, and prevent submit until checks load. | On readiness failure, the form clearly reports the problem and blocks progression until a successful retry. | Implemented. Retry preserves the entered form values. |
| F-04 | Foster | `lykasAdmin/src/pages/Fosters.tsx` | Medium | Confirmed issue | “Fosterer is adopting the pet” and “Pet is returned to the shelter” both led to a footer action labeled “Complete placement.” | The action label did not make the chosen closure outcome clear. | Staff could misunderstand which disposition they were confirming. | Show a confirmation summary with pet, closure outcome, and consequences. | Before closure, staff see and confirm the exact selected outcome. | Implemented with an outcome-specific closure review and confirmation step. |
| F-05 | Foster | `lykasAdmin/src/components/fosters/FosterReportsModal.tsx` | Medium | Confirmed issue | Weekly reports were shown as expandable rows, with only one week open at a time. Health flags appeared within an expanded report. | Comparing values and health signals across weeks required repeated open/close actions. | Trends in appetite, energy, weight, and health concerns could be harder to recognize. | Add a compact week-by-week comparison while retaining full report details. | Staff can compare reported values and identify health-flagged or overdue weeks without opening reports one at a time. | Week-by-week comparison table added. Runtime behavior was not tested. |
| F-06 | Foster | `lykasAdmin/src/pages/Fosters.tsx` | Medium | Confirmed issue | End-date badges used browser-local `Date.now()` and relative wording such as “Ends tomorrow” and “Overdue.” | Relative date wording can be interpreted differently near date boundaries or across time zones. | Staff could disagree about when a placement is due for action. | Use an agreed shelter timezone and date comparison policy, with an explicit “today” state if required by the shelter’s rules. | Boundary dates display consistently in the configured shelter timezone and include an unambiguous current-day state. | Not implemented. The shelter timezone/date policy was not established during this audit; no business rule was inferred. |
| F-07 | Foster | `lykasAdmin/src/pages/Fosters.tsx` | Medium | Confirmed issue | Closure was submitted directly from the manage form using the same generic “Complete placement” action for both outcomes. | There was no explicit review step before closing the placement. | An unintended outcome selection could close a placement with the wrong disposition. | Require an outcome-specific confirmation summary before closure. | Closure requires a second explicit action that repeats the pet and selected disposition. | Implemented. |
| F-08 | Foster | `lykasAdmin/src/pages/Fosters.tsx`, `lykasAdmin/src/components/fosters/FosterReportsModal.tsx` | Medium | Confirmed issue | Attention counts were loaded separately from the placement list, and individual report content was shown in a modal. | Staff had limited context for understanding which placement had a serious concern and what that concern was without opening its reports. | Medical follow-up could be delayed if an aggregate attention flag was overlooked. | Keep health-attention signals prominent in the list and show flagged weeks and reasons in the report comparison/details. | A serious report concern is visible from the placement row and its week and reason are easy to identify in report review. | Placement-level attention indicators and report-level health reasons are present; week-by-week comparison was added. Runtime visibility was not tested. |

## Red-team scenario coverage

| Scenario | Evidence-based conclusion |
|---|---|
| Missing or rejected identity document | Identity status is shown on application details when account verification fields are returned; document review is a separate page. A direct document-review link has since been added. The live document scenario was not exercised. |
| Incomplete interview or home visit | The application detail has a stage pipeline and next-step links. Server code requires sequential stage transitions and a final decision at the risk-assessment stage. Whether each stage has a complete interview or visit record is not established by the frontend review. |
| Incomplete risk assessment | The risk form requires six numeric inputs in the 1–5 range. The backend computes the total and risk level. Scores now start blank; submission and validation were not run. |
| Application has outstanding applicant information | Application details list missing phone, address, household size, and experience. This warning is informational; code review did not establish that these fields block stage advancement. |
| Pet becomes unavailable during an application | The server rejects creating a new application for a non-available pet. Handling of a pet whose availability changes during an existing application was not established by this review. |
| Overdue foster reports | The report modal derives overdue weeks from the missing-report endpoint. The placement list now displays overdue counts. Runtime behavior was not exercised. |
| Serious medical concern in a report | Report attention signals include vet visit required, health concerns, concerning progress, poor appetite, and lethargy. Readiness checks surface veterinary requirements before extension or closure when data is available. |
| Rejected extension request | The reviewed UI performs an admin-authorized extension directly; a separate extension-request review flow was not found. No request workflow or business rule was invented. |
| Placement reaches its end date | The list displays expected end date and relative badges. Date boundary behavior depends on browser-local time; shelter timezone policy remains unresolved. |
| Closure with incomplete information | The UI asks for a staff health check and presents missing/unreviewed report and veterinary blockers when readiness data is available. Server-side checks were inspected but not executed. |

## Shared usability and accessibility notes

- The shared `DataTable` already supports horizontal scrolling. A focusable, labeled results region and a minimum table width were added to make narrow-screen navigation more discoverable.
- Search controls now derive a more descriptive accessible name from the page-specific search placeholder.
- Shared modals now constrain their height to the viewport and scroll their content area, reducing the risk of losing access to controls on short screens.
- Existing loading, error, retry, and empty-state components are used in the reviewed flows. Helpful empty-state descriptions were added for Adoption, Foster, and Risk Assessment lists.
- Browser-based responsive and assistive technology checks remain outstanding.

## Priority summary

### P0

- Application details, progress tracker, decision summary, foster dashboard, overdue reports, and medical alerts.
- Implemented P0 work: application document-review link, native disabled decision controls with an announced reason, foster report-count error handling, overdue counts, and visible readiness loading/errors with retry.

### P1

- Risk assessment detail, weekly report comparison, extension review and dates, and placement closure.
- Implemented P1 work: six-criteria risk details, report comparison table, current/projected extension dates, and outcome-specific closure confirmation.

### P2

- Search, filters, responsive layouts, accessibility, empty states, and visual consistency.
- Implemented P2 work: adoption stage filtering, accessible table search and scroll region, viewport-bounded modals, and clearer empty-state descriptions.
- Remaining known item: end-date boundary wording requires a shelter timezone/date policy before it can be changed safely.

## Verification and changes

`git diff --check` passed during implementation. Focused UI tests were attempted but could not run because `lykasAdmin` has no local Vitest executable installed. No dependency installation was performed. The audit and changes have not been validated in a running browser.

The implementation changed these files:

- `lykasAdmin/src/components/adoption/DecisionCard.tsx`
- `lykasAdmin/src/components/fosters/FosterReportsModal.tsx`
- `lykasAdmin/src/components/ui/DataTable.tsx`
- `lykasAdmin/src/components/ui/Modal.tsx`
- `lykasAdmin/src/pages/Adoptions.tsx`
- `lykasAdmin/src/pages/ApplicationDetails.tsx`
- `lykasAdmin/src/pages/Fosters.tsx`
- `lykasAdmin/src/pages/RiskAssessments.tsx`
- `lykasAdmin/tests/pages/ApplicationDetails.test.tsx`
- `lykasAdmin/tests/pages/Fosters.test.tsx`
