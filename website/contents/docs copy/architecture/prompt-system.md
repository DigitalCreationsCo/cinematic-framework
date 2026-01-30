# Role-Based Prompt Architecture

## Overview

The Cinematic Framework uses a **role-based prompt architecture** that mirrors a real film production crew. Each role has specialized expertise and contributes specific specifications at different points in the video generation workflow.

This architecture replaces verbose, multi-purpose prompts with focused, composable role-specific prompts.

## Film Production Roles

### 🎬 **DIRECTOR**
*   **Responsibility**: Creative vision, narrative intent, emotional arc.
*   **Used In**: Creative expansion, Storyboard beat structure.
*   **Output**: Logline, character arcs, scene narrative intent.

### 📷 **CINEMATOGRAPHER**
*   **Responsibility**: Shot composition, camera movement, framing.
*   **Used In**: Storyboard enrichment, Frame generation.
*   **Output**: Shot type (ECU, MCU, Wide), Camera Angle, Camera Movement (Dolly, Pan, Tilt).

### 💡 **GAFFER**
*   **Responsibility**: Lighting design, atmosphere.
*   **Used In**: Scene enrichment, Frame generation.
*   **Output**: Light quality (Soft/Hard), Source motivation, Color temperature.

### 📋 **SCRIPT SUPERVISOR**
*   **Responsibility**: Continuity tracking (characters, props, geography).
*   **Used In**: Frame generation, Scene generation.
*   **Output**: Appearance checklists, Spatial continuity, Carryforward notes.
*   **Note**: Heavily relies on the **Temporal State System** to track persistent changes (injuries, dirt).

### 👔 **COSTUME & MAKEUP**
*   **Responsibility**: Character appearance details.
*   **Used In**: Character Reference Sheet generation.
*   **Output**: Physical description, clothing inventory, hair specifications.

### 🎨 **PRODUCTION DESIGNER**
*   **Responsibility**: World building, environment, architecture.
*   **Used In**: Location Reference Sheet generation.
*   **Output**: Location type, era, atmospheric conditions, spatial layout.

### 🎭 **FIRST AD** (Assistant Director)
*   **Responsibility**: Safety compliance, technical feasibility.
*   **Used In**: Pre-generation safety check.
*   **Output**: Sanitized prompts (removal of celebrity names, safety violations).

### 🎞️ **QUALITY CONTROL SUPERVISOR**
*   **Responsibility**: Evaluation and feedback.
*   **Used In**: Quality Loop.
*   **Output**: Department-specific scores, issue identification, retry recommendations.

## Meta-Prompting for Video Generation

In the final scene generation step (Generation Point 3.3), the system uses **Meta-Prompting**. Instead of simply concatenating strings, the system constructs a detailed instruction set for a "High-Reasoning LLM".

1.  **Input**: All department specs (Director's vision, Cinematographer's shot list, Script Supervisor's continuity notes, etc.).
2.  **Process**: The High-Reasoning LLM synthesizes these conflicting or overlapping inputs into a single, cohesive video generation prompt optimized for the target model (e.g., LTX-Video).
3.  **Output**: A concise, dense, technically accurate prompt for the video model.

## Composability Pattern

The `prompt-composer.ts` module manages how these roles are combined.

*   **Storyboard Phase**: Director + Cinematographer + Gaffer
*   **Asset Phase**: Costume (Characters) / Production Design (Locations)
*   **Scene Generation Phase**: All Roles → Meta-Prompt → Synthesized Output