# AEGIS Legacy Extension Design Audit

This note evaluates the shared browser-extension-style designs as potential starting points for the current AEGIS product direction.

These reference designs are useful, but they represent a different product type:

1. single-purpose downloader
2. constrained browser-extension panel
3. action-heavy utility workflow

AEGIS is broader:

1. media operations platform
2. source and run monitoring system
3. catalog and inspection product
4. future admin and publishing surface

The right approach is to reuse interaction patterns and visual components selectively, not to port the overall screen model directly.

## Overall Assessment

The reference designs contain strong building blocks for:

1. grouped controls
2. selection and queue review
3. compact filter chips
4. clearly framed action areas
5. dark, focused operational mood

They are weak as a direct model for:

1. information architecture
2. multi-object navigation
3. dashboard and monitoring
4. desktop-scale layouts
5. progressive drill-down across Sources, Runs, and Items

## What Is Worth Reusing

### 1. Sectioned Control Blocks

The collapsible panel approach is solid.

Useful traits:

1. clear section labeling
2. distinct boundaries between related settings
3. readable chunking of dense options

Good AEGIS translation:

1. Run Detail sections
2. Item Detail metadata panels
3. Source settings panels
4. Issues filter groups

### 2. Filter Chip Pattern

The compact pill filters are a good starting point.

Useful traits:

1. quick scanning
2. low-friction toggling
3. supports multi-select mental model

Good AEGIS translation:

1. Catalog filter chips
2. Issues type filters
3. Runs saved views
4. Source platform and health filters

### 3. Queue Review List

The queue review view is one of the strongest patterns in the references.

Useful traits:

1. compact rows with thumbnails
2. high scannability
3. clear selection state
4. obvious large action CTA

Good AEGIS translation:

1. Run Detail item results table
2. Publish queue review later
3. Bulk review mode in Catalog
4. Issues triage list

### 4. Status Through Framing, Not Just Color

The designs use borders, grouping, and toggles in addition to accent color. That is directionally good.

Good AEGIS translation:

1. status badges with icon plus label
2. bordered callouts for warnings
3. section-level health framing on Dashboard and Source Detail

### 5. Focused Primary CTA Placement

The bottom-anchored main action is effective in a task-oriented flow.

Good AEGIS translation:

1. `Run Ingest` on Source Detail
2. `Rebuild Catalog` in admin-only contexts later
3. `Retry Run` or `Open Failed Items` on Run Detail

## What Should Not Be Carried Forward Directly

### 1. Single Long Scroll Utility Layout

The extension UI depends on one narrow, vertical, utility-first scroll.

Why it does not fit AEGIS:

1. AEGIS has multiple object types
2. users need comparison views, tables, and drill-down
3. desktop layouts should use multiple panels and denser horizontal structure

### 2. Downloader Language

Terms like `Scan Library`, `Start Download`, and `Backup` are too narrow.

For AEGIS, language should shift to:

1. `Run Ingest`
2. `Review Items`
3. `Open Run`
4. `Catalog Updated`
5. `Issue Detected`
6. `Artifacts Available`

### 3. Toggle Overload

The extension patterns rely heavily on many small toggles and checkboxes.

Why this is risky for AEGIS:

1. operational screens should emphasize understanding over configuration
2. too many toggles flatten hierarchy
3. platform settings belong in dedicated settings surfaces, not everywhere

### 4. Consumer-Dark Neon Styling

The dark palette is usable, but the pink-orange CTA gradient reads more consumer utility or creator tool than enterprise-grade operations platform.

For AEGIS:

1. keep the confidence and focus of dark framing if desired
2. reduce novelty in accent treatment
3. use status color with more discipline
4. reserve saturated accents for action or exception states

### 5. Flat Information Hierarchy

The extension UI is good at "configure then execute" but not strong at "understand system state, then investigate."

AEGIS needs:

1. summary-to-detail hierarchy
2. cross-linking between objects
3. dashboard and list surfaces that support triage first

## Screen Pattern Mapping To AEGIS

### Reference: Workspace Selector

Potential reuse:

1. Source grouping panel
2. account or playlist quick filters in Catalog
3. source grouping by platform or workspace later

### Reference: Filter Content and Exclusions

Potential reuse:

1. Catalog filters
2. Issues-type filters
3. saved filter chips on Runs

### Reference: File Options

Potential reuse:

1. artifact presence module on Item Detail
2. export options in later admin workflows
3. media completeness indicators

### Reference: Review Download Queue

Potential reuse:

1. review affected items in Run Detail
2. manual queue review for publish workflow later
3. selection patterns for batch actions

### Reference: Scan / Start Download CTA

Potential reuse:

1. Trigger Run CTA on Source Detail
2. Retry failed run CTA on Run Detail
3. Start publish batch CTA in future queue management

## Visual Guidance Based On These References

The references suggest a design language with:

1. dark structured surfaces
2. compact cards
3. thin borders
4. small uppercase labels
5. high emphasis CTAs

This can inform AEGIS, but should be adjusted:

1. increase hierarchy between page, section, and component
2. make data tables cleaner and less visually noisy
3. create more breathing room for desktop layouts
4. use stronger typography contrast between headers and metadata
5. make status treatment more semantic and less decorative

## Recommended Reuse Strategy

### Reuse Directly

1. compact filter chips
2. section headers with clear framing
3. queue review row structure
4. thumbnail-plus-metadata row composition
5. compact action bars

### Reinterpret

1. dark theme styling
2. CTA treatment
3. toggle modules
4. collapsible sections
5. progress messaging

### Retire

1. single-column extension page architecture
2. downloader-specific language
3. settings-heavy default views
4. all-in-one utility scroll model

## Implications For Current AEGIS Screens

### Dashboard

Do not model this after the extension.

Instead reuse:

1. compact status cards
2. grouped issue panels

### Sources List and Source Detail

Reuse:

1. grouped settings cards
2. source-specific CTA placement
3. compact filter chip style

### Runs List and Run Detail

Reuse:

1. queue review density
2. progress messaging
3. item-row selection and inspection patterns

### Catalog Browser

Reuse:

1. thumbnail and metadata row structure
2. compact chips and exclusions logic

Do not reuse:

1. utility configuration framing as the dominant layout

### Item Detail

Reuse:

1. artifact option grouping
2. media-first summary block

## Bottom Line

These legacy designs are valuable as a component and interaction reference set, not as a page architecture reference set.

Best use:

1. borrow selection patterns
2. borrow chip filters
3. borrow compact media row design
4. borrow framed settings sections where needed
5. translate all of that into the new AEGIS model:
   - Dashboard
   - Sources
   - Runs
   - Catalog
   - Issues

The right design move is evolution, not migration.
