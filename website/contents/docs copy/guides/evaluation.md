# Quality Evaluation Best Practices

This guide outlines strategies for maintaining and improving the quality of generated video content in the Cinematic Framework.

## 1. Quick Wins

### Add Generation Rules
Initialize domain-specific generation rules at the start of the workflow. For example, if the scene descriptions involve "surfing", automatically inject a rule clarifying what "barrel" means in that context (water wave vs. wooden container).

### Environment Tuning
Adjust sensitivity thresholds in your `.env` file based on your quality goals:
*   `ACCEPT_THRESHOLD=0.90` (Accept good enough results)
*   `MAJOR_ISSUE_THRESHOLD=0.70` (Fail fast on major errors)

## 2. Debugging Failures

### Pattern: Quality Degrading
If quality drops with subsequent retry attempts, the correction prompts might be removing necessary detail.
*   **Fix**: Reset to Attempt 1 prompt or switch to "Conservative" correction strategy.

### Pattern: Semantic Misunderstanding
If the model consistently misinterprets a word (e.g., "crane" bird vs. machine).
*   **Fix**: Add an explicit negative constraint or clarification rule to the Generation Rules array.

### Pattern: Character Consistency
If characters change appearance or gender between shots.
*   **Fix**: Ensure `referenceImageUrls` are passed correctly and emphasized in the prompt as "Ground Truth".

## 3. Monitoring & Alerts

Implement alerting for:
*   **Consistent Decline**: Score drops across 2+ attempts.
*   **Stuck Scores**: Corrections are having no effect.
*   **Critical Failures**: Final attempt is still below the fail threshold.

## 4. Persistence

All evaluation results (scores, issues, corrections) are persisted in the **PostgreSQL Checkpoint**. This allows you to:
1.  Resume interrupted workflows without losing evaluation history.
2.  Analyze long-term trends in model performance.
3.  Replay specific scenes with different retry strategies.