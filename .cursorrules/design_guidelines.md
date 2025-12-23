# Design Guidelines: Cinematic Video Generation Pipeline Frontend

## Application Overview

A single-page application interface frontend for a cinematic video generation pipeline, including scene generation views, start and end reference image views, performance metrics, and asynchronous handling and UI updates for the user during pipeline processes (segment skeletons, messages, error messages).
UI is space-efficient, dense yet readable, logically organized, and well-designed.

## Design Approach

**Selected Framework**: Material Design with Linear-inspired refinement for production tool clarity
**Rationale**: Data-heavy, utility-focused application requiring information density, real-time state management, and professional workflow efficiency. Drawing from Linear's clean production aesthetics combined with Material's robust component patterns for complex interfaces.

---

## Core Design Principles

1. **Information Density**: Maximize visible data without overwhelming - every pixel serves a purpose
2. **Status Clarity**: Real-time pipeline state must be immediately apparent through visual hierarchy
3. **Workflow Efficiency**: Minimize clicks, maximize keyboard shortcuts and quick actions
4. **Data Visualization**: Metrics, timelines, and quality scores as first-class visual elements

---

## Typography System

**Font Families**:

- Primary: Inter (via Google Fonts) - weights 400, 500, 600, 700
- Monospace: JetBrains Mono - weight 400 for technical data (timestamps, IDs, URLs)

**Type Scale**:

- Page Titles: text-2xl (24px), font-semibold
- Section Headers: text-lg (18px), font-semibold
- Card Titles: text-base (16px), font-medium
- Body Text: text-sm (14px), font-normal
- Labels/Metadata: text-xs (12px), font-medium, uppercase tracking
- Technical Data: text-xs (12px), font-mono

---

## Layout System

**Spacing Primitives**: Use Tailwind units of 1, 2, 3, 4, 6, 8, 12

- Component padding: p-3, p-4
- Section spacing: space-y-4, gap-4
- Card margins: m-2, m-3
- Grid gaps: gap-3, gap-4

**Grid Structure**:

- Main dashboard: 3-column grid (lg:grid-cols-3) for storyboard cards
- Scene cards: 2-column grid (md:grid-cols-2) for metadata pairs
- Metrics: 4-column grid (lg:grid-cols-4) for performance stats
- Detail panels: 70/30 split (video preview / metadata sidebar)

**Container Strategy**:

- Full-width app with max-w-screen-2xl for ultra-wide displays
- Dense padding: px-4 py-3 for main containers
- Nested cards use p-3 for compact information display

---

## Component Library

### Navigation & Structure

- **Top Bar**: Fixed header with project selector, user menu, global actions (height: h-14)
- **Side Panel**: Collapsible navigation (w-64 expanded, w-16 collapsed) with scene list, character/location quick access
- **Tab Navigation**: For switching between Storyboard, Scenes, Metrics, Characters, Locations views

### Data Display Components

**Scene Cards**: Compact cards showing:

- Scene ID badge (top-left, small pill)
- Shot type and duration (header row)
- Video thumbnail with play overlay (16:9 aspect ratio)
- Inline metadata grid: camera movement, lighting, mood (2-column, text-xs)
- Quality score bar (horizontal, color-coded)
- Status indicator (pulsing dot for generating, checkmark for complete)

**Timeline Visualization**:

- Horizontal scrollable timeline showing all audio segments
- Height: h-24, segments as colored blocks with duration labels
- Lyric overlay on hover, transition markers between segments

**Metrics Dashboard**:

- Stat cards in 4-column grid: Avg Attempts, Quality Trend, Total Duration, Rules Added
- Large number (text-3xl), label below (text-xs)
- Sparkline charts showing trends (compact, h-12)

**Quality Evaluation Panel**:

- Horizontal score bars for each dimension (narrativeFidelity, characterConsistency, etc.)
- Rating badges (PASS=green, MINOR_ISSUES=yellow, MAJOR_ISSUES=orange, FAIL=red)
- Expandable issue list with severity icons and timestamps

**Reference Image Gallery**:

- Masonry grid for character/location reference images (grid-cols-2 md:grid-cols-3)
- Image cards with overlay text showing ID and name
- State tracking indicators (last seen scene, current appearance notes)

### Interactive Elements

**Status Indicators**:

- Pulsing animation for "generating" state (animate-pulse on status dot)
- Progress bars with percentage (h-2, rounded-full)
- Toast notifications for errors/warnings (fixed bottom-right, stack vertically)

**Action Buttons**:

- Primary: Solid background, medium size (px-4 py-2)
- Secondary: Outline style
- Icon-only: Square (w-8 h-8) for compact toolbars

**Form Inputs**: (when needed for prompts)

- Textarea with character count (h-32 for creative prompts)
- Dropdown selects for duration, shot type (h-10)
- File upload dropzone for audio (border-dashed, h-40)

---

## Real-Time Update Patterns

**Loading States**:

- Skeleton screens for scene cards during initial load (animate-pulse on empty cards)
- Inline spinners for individual scene generation (w-4 h-4 next to scene ID)
- Progress bars showing completion percentage for pipeline steps

**WebSocket Status**:

- Connection indicator in top bar (green dot = connected, red = disconnected)
- Message queue display showing recent events (scrollable list, max-h-32, text-xs)

**Error Display**:

- Error cards with red left border (border-l-4)
- Expandable stack trace for technical details
- Dismissible toast notifications for transient errors

---

## Visual Hierarchy & Density

**Card Elevation**: Use subtle shadows, not excessive depth

- Level 1: shadow-sm for base cards
- Level 2: shadow-md for modals and overlays
- Hover: shadow-lg on interactive cards

**Border Strategy**:

- Subtle borders (border border-gray-200) for card separation
- Thicker accent borders (border-l-4) for status/severity indicators
- No borders on main containers, rely on spacing and background differentiation

**Whitespace Management**:

- Tight line-height (leading-tight, leading-snug) for dense data
- Consistent gap-3 or gap-4 between related elements
- Generous gap-8 between major sections

---

## Images

**Hero Section**: None - this is a utility application, launch directly into dashboard
**Reference Images**: Character and location reference images displayed as thumbnails in gallery grids (aspect-video or aspect-square, object-cover)
**Video Previews**: Scene video thumbnails at 16:9 ratio with play overlay icon
**Placeholder Images**: Use generic placeholder service (placeholder.com or similar) for missing reference images

---

## Accessibility & Responsiveness

- Maintain ARIA labels for all interactive elements
- Keyboard navigation: Tab through scenes, Enter to expand details
- Focus indicators: ring-2 ring-offset-2 on focus states
- Mobile: Stack cards vertically, collapsible panels become drawers
- Tablet: 2-column grids, side panel overlays instead of fixed
- Desktop: Full 3-4 column layouts, persistent navigation

---

## Animation Guidelines

**Use Sparingly**:

- Loading spinners for async operations (animate-spin)
- Pulsing dots for "generating" status (animate-pulse)
- Smooth transitions for panel collapse/expand (transition-all duration-200)
- No decorative animations - every animation serves functional feedback
