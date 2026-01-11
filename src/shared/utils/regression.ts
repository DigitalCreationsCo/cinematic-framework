/**
 * Simple linear regression to predict future attempts based on history
 */
export function calculateTrend(values: number[]): { slope: number, intercept: number } {
    const n = values.length;
    if (n === 0) return { slope: 0, intercept: 0 };
    if (n === 1) return { slope: 0, intercept: values[0] };

    const xSum = (n * (n - 1)) / 2; // Sum of 0..n-1
    const ySum = values.reduce((a, b) => a + b, 0);
    
    // Sum of x*y
    let xySum = 0;
    for(let i=0; i<n; i++) {
        xySum += i * values[i];
    }

    // Sum of x^2
    let x2Sum = 0;
    for(let i=0; i<n; i++) {
        x2Sum += i * i;
    }

    const slope = (n * xySum - xSum * ySum) / (n * x2Sum - xSum * xSum);
    const intercept = (ySum - slope * xSum) / n;

    return { slope, intercept };
}

export function predictRemainingAttempts(
    attemptHistory: number[],
    remainingScenes: number
): number {
    if (attemptHistory.length < 2) {
        // Fallback to average or default
        const avg = attemptHistory.length > 0 ? attemptHistory[0] : 1;
        return Math.ceil(avg * remainingScenes);
    }

    const { slope, intercept } = calculateTrend(attemptHistory);
    const currentSceneIndex = attemptHistory.length;

    let totalPredicted = 0;
    for (let i = 0; i < remainingScenes; i++) {
        const x = currentSceneIndex + i;
        const predicted = Math.max(1, slope * x + intercept); // At least 1 attempt
        totalPredicted += predicted;
    }

    return Math.ceil(totalPredicted);
}
