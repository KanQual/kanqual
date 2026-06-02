# Menu Modal UX Audit

This document focuses on menu-style and settings-style modals that currently feel busy or visually flat. The goal is to create clearer hierarchy, faster scanning, and more confident decision-making.

## Core principle

A modal should answer these questions in order:

1. What is this modal for?
2. What is the primary thing I should do here?
3. What is secondary?
4. What is risky or advanced?

Right now many modals answer all four at the same visual weight.

## Recommended modal system

### 1. Action chooser modal

Use when the user is picking one next step.

Structure:

1. Title
2. One-sentence purpose
3. Stacked action cards
4. Optional advanced section
5. Footer with cancel/close

Best for:

- `Projects > New Project`
- import mode pickers
- “what should I do next?” style setup dialogs

### 2. Settings panel modal

Use when the user is editing or configuring.

Structure:

1. Title
2. Short description
3. Section groups with labels
4. Inputs or toggles inside each group
5. Sticky footer with cancel/save

Best for:

- App Settings card modals
- Project Settings card modals
- Backup Settings
- User Settings profile/password/appearance modals

### 3. Confirmation modal

Use when the user is confirming a single important action.

Structure:

1. Title
2. Plain-language consequence
3. Optional warning box
4. Two-button footer

Best for:

- delete
- restore
- destructive source-file cleanup
- import/restore completion follow-up

## Shared hierarchy rules

### Visual hierarchy

- One primary action only
- Section headers for grouped controls
- Secondary actions should be visually quieter than the primary CTA
- Destructive actions should live in a separated danger zone or danger footer
- Metadata should use muted text styling, not compete with task labels

### Content hierarchy

- Title: what this is
- Description: why you are here
- Section label: what kind of choices are below
- Row description: what happens if clicked

### Density rules

- Prefer 2 to 5 meaningful choices per group
- If a modal has more than 6 peer actions, split them into groups
- Avoid long runs of equal-weight buttons
- Prefer stacked rows/cards over crowded button grids when choices are conceptually different

## Current recurring problems

### 1. Flat visual weight

Many modals present every option with the same typography, spacing, and emphasis. Users must read line by line to understand importance.

### 2. No primary-path emphasis

Several modals have multiple legitimate actions, but none is framed as the main path.

### 3. Action-heavy footers

Some dialogs rely too much on button rows to carry meaning. The body should do more of the guidance.

### 4. Mixed modal roles

Some dialogs combine “chooser”, “settings”, and “confirmation” behaviors in one visual pattern, so users do not get strong affordances about what kind of decision they are making.

### 5. Weak destructive separation

Risky actions are sometimes visually too close to routine actions.

## Modal-by-modal recommendations

## 1. Projects: New Project flow

File:

- `src/views/Projects_View.tsx`

Current pattern:

- One chooser modal for `New Project`
- Several follow-up modals for create/import/import-encrypted/import-refi

What works:

- The option list already has title + description
- Import steps are separated by modal mode

Problems:

- The chooser presents all options as equal peers
- “Create Empty Project” is likely the default path but is not visually prioritized
- Encrypted backup and REFI import are more advanced flows but are not visually separated

Recommended redesign:

- Split chooser into two groups:
  - `Start New`
  - `Import Existing`
- Make `Create Empty Project` the visually dominant first card
- Put `Import Encrypted Backup` under an `Advanced Import` subheading or secondary section
- Add lightweight badges where useful:
  - `Recommended`
  - `Advanced`
  - `Secure`

Suggested structure:

1. `Create Empty Project` as primary card - and visually distinct
2. `Import Project`, `Import Encrypted Backup`, and `Import REFI-QDA Project` as standard cards


## 2. App Settings card modals

File:

- `src/views/App_Settings_View.tsx`

Current pattern:

- Overview cards open one large modal shell with shared title/description/body

What works:

- There is already a good shared modal shell
- The card model is conceptually strong

Problems:

- The modal shell can become a container for very different interaction types without stronger internal section hierarchy
- Large forms/settings bodies can feel like long undifferentiated vertical stacks

Recommended redesign:

- Keep the shared shell
- Add internal section dividers inside each modal body
- Standardize section anatomy:
  - section heading
  - one-sentence explanation
  - controls
- For long settings modals, use a sticky footer for `Cancel` / `Save`
- For diagnostic/setup modals, promote the main action near the top rather than only at the bottom

Best use of hierarchy:

- top summary box for the “what matters here”
- grouped settings sections below
- footer actions last

## 3. Project Settings card modals

File:

- `src/views/Project_Settings_View.tsx`

Current pattern:

- Similar to App Settings: overview cards open shared shell modals
- Additional standalone modals exist for backup settings, restore, delete, AI Assist prep, and project details

What works:

- Shared card-to-modal transition is good
- Some modals already have useful descriptions

Problems:

- Some modals are configuration-heavy and would benefit from sectioned panel layout
- Some confirmation dialogs are clear, but the ecosystem overall mixes chooser/configuration/confirmation styles
- Backup-related actions can feel dense because retention, restore, delete, and status all live near each other conceptually

Recommended redesign:

- Treat backup-related dialogs as a mini system with consistent structure:
  - summary
  - impact
  - controls
  - footer
- In `Backup Settings`, add visible section headers:
  - `Frequency`
  - `Retention`
- In AI Assist prep/build dialogs, show a short readiness summary block before the explanatory copy
- In completion dialogs like `Codebook Imported` and `Project Restore Complete`, reduce body copy and promote the next step more strongly

## 4. User Settings modals

File:

- `src/views/User_Settings_View.tsx`

Current pattern:

- Overview cards open specific modals for profile, password, appearance, and recent projects

What works:

- Good separation by task
- Titles are clear

Problems:

- Some modals still rely on uniform rows rather than stronger grouping
- Appearance settings combine several different preference types that could benefit from clearer sectioning
- Close-only footers can feel abrupt for settings that are really a set of distinct categories

Recommended redesign:

- `Profile` and `Password` are already close to good confirmation/settings hybrids
- `Appearance` should be split into visual groups:
  - `Theme`
  - `Density`
  - `Typography`
  - `Custom Theme`
- Each group should have a short explainer
- Use stronger spacing between preference families, not just between rows

## 5. Backup Settings modal

File:

- `src/views/Project_Settings_View.tsx`

Current pattern:

- A single form with interval + three retention fields

Problems:

- Four fields are conceptually split across two ideas, but visually they read as one flat form

Recommended redesign:

- Add section heading `Frequency`
- Add section heading `Retention Windows`
- Represent hourly/daily/weekly as related cards or grouped controls in a clearly shared block
- Add a small summary sentence under the retention block such as:
  - `Automatic backups will rotate through hourly, daily, and weekly windows.`

## 6. AI Assist prep/build dialogs

Files:

- `src/views/Project_Settings_View.tsx`
- `src/views/AIAssist_Home_View.tsx`

Current pattern:

- Explanatory text plus run/cancel style footer

Problems:

- Important setup requirements are embedded in paragraphs
- The user has to extract “what is blocked” and “what happens next”

Recommended redesign:

- Use a top status summary card:
  - `Requirement`
  - `Current status`
  - `Next step`
- Then show the narrative explanation below
- Keep a single primary CTA

## 7. Confirmation modals

Files:

- `Projects_View.tsx`
- `Project_Settings_View.tsx`
- `Project_Home_View.tsx`
- reports views

What works:

- Most already use simple two-button footers

Problems:

- Some confirmations rely on generic copy rather than visually separating consequence details

Recommended redesign:

- Use one pattern consistently:
  - title
  - consequence sentence
  - optional warning block
  - cancel + destructive CTA
- If irreversible, use a visibly separated warning box

## Priority implementation order

### High impact

1. `Projects > New Project` chooser
2. Project Settings card modals
3. App Settings card modals

These are likely the biggest “busy and flat” offenders because they contain many peer actions.

### Medium impact

1. User Settings appearance modal
2. Backup Settings modal
3. AI Assist prep/build dialogs

### Lower impact

1. Simple confirmations
2. Help modals
3. Completion dialogs

These still matter, but they are not the biggest hierarchy problem.

## Suggested reusable UI primitives

To make this consistent in code, create a few shared building blocks:

- `ModalHeader`
  - title
  - description
  - close action
- `ModalSection`
  - heading
  - subcopy
  - content
- `ActionCardList`
  - stacked chooser rows/cards
- `DangerZone`
  - separated destructive actions
- `ModalFooter`
  - primary + secondary actions
- `StatusSummary`
  - for setup and readiness dialogs

## Practical design rules for this repo

- If the modal asks “which path do you want?”, use action cards.
- If the modal asks “configure this”, use sections.
- If the modal asks “are you sure?”, use a compact confirmation layout.
- Never place destructive actions in the same visual group as routine settings.
- Never let more than one button feel equally primary.
- Use muted helper text aggressively to reduce label overload.

## Recommended first implementation pass

If we want the biggest UX improvement quickly, start here:

1. Redesign `Projects > New Project` as a grouped action chooser
2. Standardize App Settings and Project Settings modal shells with internal sections
3. Add a `DangerZone` pattern for destructive project and backup actions
4. Refactor appearance and backup settings to use grouped sections instead of flat control stacks

That would make the modal system feel much more intentional without requiring a full redesign of every dialog at once.
