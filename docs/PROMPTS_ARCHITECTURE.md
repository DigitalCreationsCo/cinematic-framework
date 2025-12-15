# Role-Based Prompt Architecture

## Overview

The Cinematic Framework uses a **role-based prompt architecture** that mirrors a real film production crew. Each role has specialized expertise and contributes specific specifications at different points in the video generation workflow.

This architecture replaces verbose, multi-purpose prompts with focused, composable role-specific prompts that:
- ✅ Reduce token usage and latency
- ✅ Improve output quality through specialized expertise
- ✅ Enable precise debugging (identify which role's specs failed)
- ✅ Facilitate iterative improvement (only failing roles revise specs)
- ✅ Create clear separation of concerns

---

## Film Production Roles

### 🎬 **DIRECTOR** - Creative Vision & Story Development
**File**: [`pipeline/prompts/role-director.ts`](pipeline/prompts/role-director.ts)

**Responsibility**: Overall creative vision, narrative intent, emotional arc, character/location concepts

**Used In**:
- Generation Point 1.1: Creative prompt expansion
- Generation Point 1.3: Initial storyboard context (metadata, characters, locations)
- Generation Point 1.4: Scene beat structure

**Output**:
- Logline and visual style
- Character profiles (personality, arc, key actions)
- Location concepts (atmosphere, mood)
- Scene-by-scene narrative intent

**Key Improvement**: Eliminated philosophical language ("be authentic"), replaced with concrete action descriptions and structured character/location specifications.

---

### 📷 **CINEMATOGRAPHER** - Shot Composition & Framing
**File**: [`pipeline/prompts/role-cinematographer.ts`](pipeline/prompts/role-cinematographer.ts)

**Responsibility**: Shot type, camera angle, camera movement, composition rules

**Used In**:
- Generation Point 1.4: Storyboard enrichment (shot specs per scene)
- Generation Point 3.1 & 3.2: Frame composition (start/end keyframes)

**Output**:
- Shot type (ECU, CU, MCU, MS, MW, WS, VW)
- Camera angle (Eye Level, High, Low, Bird's Eye, Dutch)
- Camera movement (Static, Pan, Tilt, Dolly, Track, Handheld, Crane)
- Composition details (subject placement, focal point, depth layers)

**Key Improvement**: Replaced open-ended descriptions with constrained menus. Cinematographer selects from predefined options rather than inventing terminology.

---

### 💡 **GAFFER** - Lighting Design
**File**: [`pipeline/prompts/role-gaffer.ts`](pipeline/prompts/role-gaffer.ts)

**Responsibility**: Lighting quality, motivated sources, color temperature, atmospheric effects

**Used In**:
- Generation Point 1.4: Storyboard enrichment (lighting specs per scene)
- Generation Point 3.1 & 3.2: Frame lighting (keyframe-specific)

**Output**:
- Light quality (Soft/Hard)
- Color temperature (Warm/Neutral/Cool with Kelvin ranges)
- Motivated sources (where light comes from)
- Lighting direction (key light position, shadow direction, contrast ratio)
- Atmosphere (haze, fog, visible light beams)

**Key Improvement**: Replaced jargon with model-friendly motivated sources. All light must have a visible or implied natural source.

---

### 📋 **SCRIPT SUPERVISOR** - Continuity Tracking
**File**: [`pipeline/prompts/role-script-supervisor.ts`](pipeline/prompts/role-script-supervisor.ts)

**Responsibility**: Maintaining visual continuity for characters, locations, props, spatial geography across the *entire workflow*.

**Used In**:
- Generation Point 3.1 & 3.2: Frame generation (continuity requirements)
- Generation Point 3.3: Enhanced scene prompt (continuity carryforward)

**Output**:
- Character appearance checklist (hair, clothing, accessories - MUST MATCH EXACTLY)
- Spatial continuity (screen direction, exit/entry logic)
- Physical state tracking (accumulated dirt, damage, exhaustion)
- Location continuity (lighting direction, weather progression)
- Carryforward notes for next scene

**Key Improvement**: Replaced prose paragraphs with explicit checklists. Continuity state is now reliably managed via **persistent PostgreSQL checkpoints**, ensuring that temporal context is accurate even across interrupted workflow steps or when processing `RETRY_SCENE` commands.

---

### 👔 **COSTUME & MAKEUP DEPT** - Character Appearance
**File**: [`pipeline/prompts/role-costume-makeup.ts`](pipeline/prompts/role-costume-makeup.ts)

**Responsibility**: Character physical description, clothing, accessories, distinctive features

**Used In**:
- Generation Point 2.1: Character reference image generation

**Output**:
- Detailed physical description (age, build, face, ethnicity)
- Exact hair specification (style, color, length, texture)
- Clothing list (specific garments, colors, fit, condition)
- Accessories inventory
- Reference image (full-body portrait, neutral background)

**Key Improvement**: Front-loaded critical details. Removed "why this matters" explanations. Integrated safety guidelines (no celebrity likeness, age-up children).

---

### 🎨 **PRODUCTION DESIGNER** - Location & Environment
**File**: [`pipeline/prompts/role-production-designer.ts`](pipeline/prompts/role-production-designer.ts)

**Responsibility**: Location architecture, environmental elements, atmospheric conditions, spatial layout

**Used In**:
- Generation Point 2.2: Location reference image generation

**Output**:
- Location description (type, time of day, weather)
- Environmental elements (architecture, natural elements, man-made objects)
- Atmospheric conditions (lighting quality, visibility, color palette)
- Spatial layout (scale, depth, pathways)
- Reference image (wide establishing shot, no people)

**Key Improvement**: Simplified technical requirements. Focus on visible elements rather than abstract concepts.

---

### 🎭 **FIRST AD** - Technical Safety & Feasibility
**File**: [`pipeline/prompts/role-first-ad.ts`](pipeline/prompts/role-first-ad.ts)

**Responsibility**: Safety compliance, prompt sanitization, technical feasibility validation

**Used In**:
- Generation Point 3.4: Pre-video-generation safety check

**Output**:
- Sanitized prompt (celebrity references removed, ages corrected, violence softened)
- Technical feasibility confirmation (duration valid, complexity appropriate)
- Safety violation corrections with minimal changes

**Key Improvement**: Proactive checking prevents API rejections by enforcing safety rules before video generation submission.

---

### 🎞️ **QUALITY CONTROL SUPERVISOR** - Evaluation & Feedback
**File**: [`pipeline/prompts/role-quality-control.ts`](pipeline/prompts/role-quality-control.ts)

**Responsibility**: Evaluating generated assets, providing department-specific feedback

**Used In**:
- Generation Point 4.1: Scene video/frame quality evaluation
- Generation Point 4.2: Prompt correction for retries

**Output**:
- Department-specific scores (Director, Cinematographer, Gaffer, Script Supervisor, Costume)
- Issue identification (which department's specs weren't met)
- Correction suggestions (how specific departments should revise)
- Accept/Retry decision
- Generation rule suggestions (systemic improvements)

**Key Improvement**: Rubric format, weighted scoring, and clear issue traceability directly tied to the responsible role.

---

## Prompt Composition

The [`prompt-composer.ts`](pipeline/prompts/prompt-composer.ts) module provides helper functions for combining multiple role prompts at key generation points.

### Key Composition Functions

#### `composeStoryboardEnrichmentPrompt()`
**Used In**: Generation Point 1.4

Combines:
- Director (scene beat structure)
- Cinematographer (shot type menus)
- Gaffer (lighting options)

Output: Enriched scenes with narrative + shot + lighting specs

---

#### `composeFrameGenerationPrompt()`
**Used In**: Generation Points 3.1 & 3.2

Combines:
- Cinematographer (frame composition for start/end)
- Gaffer (lighting specification)
- Script Supervisor (continuity checklist)
- Costume & Makeup (character appearance specs)
- Production Designer (location environment specs)

Output: Complete keyframe prompt with all department specs

---

#### `composeEnhancedSceneGenerationPrompt()`
**Used In**: Generation Point 3.3

Combines all department specs into unified production-ready prompt:
- Director (narrative intent)
- Cinematographer (shot composition)
- Gaffer (lighting)
- Script Supervisor (continuity from previous scene)
- Costume & Makeup (character appearances)
- Production Designer (location environment)
- Global generation rules (accumulated learnings)

Output: Enhanced scene prompt for video generation API

---

#### `composeDepartmentSpecs()`
**Used In**: Generation Point 4.1

Extracts department-specific specs for evaluation:
- Director specs
- Cinematographer specs
- Gaffer specs
- Script Supervisor specs
- Costume specs
- Production Design specs

Output: Structured specs for Quality Control evaluation

---

## Complete Workflow with Role Integration

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: PRE-PRODUCTION (Planning)                              │
└─────────────────────────────────────────────────────────────────┘

1.1 Creative Expansion
    Role: DIRECTOR
    Output: Expanded creative vision

1.2 Audio Analysis
    Role: DIRECTOR (musical structure)
    Output: Segments with timing/mood

1.3 Initial Context
    Role: DIRECTOR
    Output: Metadata, characters, locations

1.4 Storyboard Enrichment
    Roles: DIRECTOR + CINEMATOGRAPHER + GAFFER (composed)
    Output: Scene[] with narrative + shot + lighting

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: ASSET GENERATION (References)                          │
└─────────────────────────────────────────────────────────────────┘

2.1 Character References
    Role: COSTUME & MAKEUP
    Output: Reference images per character

2.2 Location References
    Role: PRODUCTION DESIGNER
    Output: Reference images per location

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: SCENE GENERATION (Per Scene Loop)                      │
└─────────────────────────────────────────────────────────────────┘

3.1 Start Frame Generation
    Roles: CINEMATOGRAPHER + GAFFER + SCRIPT SUPERVISOR +
           COSTUME + PRODUCTION DESIGN (composed)
    Output: Start keyframe image

3.2 End Frame Generation
    Roles: CINEMATOGRAPHER + GAFFER + SCRIPT SUPERVISOR +
           COSTUME + PRODUCTION DESIGN (composed)
    Output: End keyframe image

3.3 Enhanced Prompt Assembly
    Roles: ALL DEPARTMENTS (composed into unified prompt)
    Output: Enhanced prompt string

3.4 Safety Sanitization
    Role: FIRST AD
    Output: Sanitized prompt

3.5 Video Generation
    Input: Sanitized prompt + keyframes + references
    Output: Generated video URL

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: QUALITY CONTROL (Evaluation & Retry)                   │
└─────────────────────────────────────────────────────────────────┘

4.1 Quality Evaluation
    Role: QUALITY CONTROL SUPERVISOR
    Output: Department-specific scores + issues + decision

4.2 Prompt Correction (if retry needed)
    Roles: SPECIFIC FAILING DEPARTMENTS (revise their specs only)
    Output: Corrected department specs
    → Loop back to 3.3 with corrected specs
```

---

## Benefits of Role-Based Architecture

### 1. Composability
Prompts are modular building blocks. Combine different roles for different generation points. Reuse same role prompt across multiple stages.

### 2. Traceability
Quality issues trace to specific departments. Know exactly which prompt to fix. Accumulated generation rules improve over time.

### 3. Efficiency
Only failing departments revise on retry. Working specs preserved across attempts. Reduced token usage (no redundant information).

### 4. Clarity
Each role has single responsibility. No conflicting instructions within a prompt. Clear menus/checklists instead of prose.

### 5. Scalability
Easy to add new roles (e.g., "Sound Designer"). Easy to update one role without affecting others. Easy to test individual role prompts.

---

## Migration from Old Prompts

Old prompt files still exist for backward compatibility but are now wrappers around role-based prompts:

| Old Prompt File | New Role-Based Implementation |
|---|---|
| `character-image-instruction.ts` | Calls `buildCostumeAndMakeupPrompt()` |
| `location-image-instruction.ts` | Calls `buildProductionDesignerPrompt()` |
| `frame-generation-instruction.ts` | Calls `composeFrameGenerationPrompt()` |
| `storyboard-composition-instruction.ts` | Uses Director + Cinematographer + Gaffer composition |

---

## Key Optimizations Applied

### 1. Storyboard Composition
- **Before**: Verbose abstract concepts ("masterful human director touch")
- **After**: Concrete shot menus, lighting options, structured scene beats
- **Reduction**: ~60% token reduction

### 2. Character/Location References
- **Before**: "Three-point lighting", "8K detail", lengthy "why this matters" sections
- **After**: "Soft even lighting", front-loaded specs, purpose section only
- **Reduction**: ~30% token reduction

### 3. Continuity Instructions
- **Before**: Prose paragraphs explaining continuity principles
- **After**: Explicit checklists with "MUST MATCH EXACTLY" markers
- **Reduction**: ~40% token reduction

### 4. Evaluation Prompts
- **Before**: 400+ line essay format with lengthy examples
- **After**: Rubric format with 3 example corrections max
- **Reduction**: ~50% token reduction

### 5. Safety Instructions
- **Before**: All error codes listed, generic guidance
- **After**: Top 3 violations prioritized, find-and-replace rules
- **Reduction**: ~40% token reduction

---

## Future Enhancements

Potential new roles to add:

- **Sound Designer**: Audio generation and sound effect specifications
- **Editor**: Transition timing, pacing, montage construction
- **VFX Supervisor**: Special effects, compositing requirements
- **Color Grader**: Post-production color correction specifications

---

## Version History

- **v3.3.1** (Current): Consolidated type imports to use shared types. Implemented comprehensive real-time logging via worker console interception and `LOG` Pub/Sub events. Frontend supports new Theatre Mode playback.
- **v3.3.0**: Refined pipeline worker execution runtime (Node.js v20, using `import.meta.main` for graph execution entry point). Integration with command-driven orchestration and persistent state management. Temporal state tracking guaranteed by PostgreSQL checkpoints.
- **v3.1.0**: Enhanced quality evaluation and retry mechanisms, including new logging, unified retry handler, and domain-specific generation rules.
- **v3.0.0**: Role-based prompt architecture implemented
- **v2.0.0**: Continuity-focused prompts with global rules
- **v1.0.0**: Initial monolithic prompt structure

---

For implementation details, see:
- [Prompt Composer](pipeline/prompts/prompt-composer.ts)
- [Role Prompts](pipeline/prompts/role-*.ts)
- [Agent Integration](pipeline/agents/)