# `retryLlmCall` — Human-in-the-Loop LLM Retry Architecture

`retryLlmCall` is a utility for invoking LLM or generative model calls with **robust error handling**, **human intervention**, and **safe parameter correction** using **LangGraph interrupts**.

It replaces blind automatic retries with a **controlled retry loop** where humans (or agents) can inspect failures, revise inputs, and retry deterministically.

---

## Core Idea

> **Only parameters explicitly passed into `retryLlmCall` are correctable.**

This is intentional.

`retryLlmCall` enforces a clear boundary between:

* **retry-visible state** (safe to inspect and edit)
* **captured state** (opaque, non-editable)

This keeps retries debuggable, reproducible, and graph-safe.

---

## Architecture Overview

```
Caller
  ↓
retryLlmCall
  ├─ calls llmCall(params)
  ├─ catches error
  ├─ emits LangGraph interrupt
  │    └─ exposes params + error + metadata
  ├─ waits for resolution
  │    ├─ retry with revised params
  │    └─ cancel
  ↓
Success or explicit failure
```

### Key Properties

* No blind retries
* No hidden state mutation
* Full human or agent control
* Compatible with LangGraph replay and inspection

---

## API

### Signature

```ts
retryLlmCall<T, U>(
  llmCall: (params: T) => Promise<U>,
  initialParams: T,
  retryConfig?: RetryConfig,
  onRetry?: (
    error: any,
    attempt: number,
    currentParams: T
  ) => Promise<T | void>
): Promise<U>
```

---

### Arguments

#### `llmCall: (params: T) => Promise<U>`

The function that executes the model call.

**Requirements**

* Must be a pure function of `params`
* Must not depend on hidden mutable state
* Must throw on failure

---

#### `initialParams: T`

The **retry surface**.

Anything in this object:

* can be inspected during interrupt
* can be corrected by humans or agents
* will be replayed deterministically

Anything *not* here is invisible and non-correctable.

---

#### `retryConfig?: RetryConfig`

Legacy-style retry config (mostly informational now).

```ts
type RetryConfig = {
  maxRetries?: number;
  initialDelay?: number;
  backoffFactor?: number;
};
```

In current architecture:

* retries are driven by interrupts
* humans or agents decide when to retry

---

#### `onRetry?: onRetry(error, attempt, params)`

Optional hook executed **before** retrying.

Used for:

* automatic param adjustment
* error-aware transformations
* safety sanitization

**Important**

* Must return a **new params object**
* Do not mutate `currentParams` in place

---

## LangGraph Interrupt Payload

On failure, `retryLlmCall` emits:

```ts
{
  type: "llm_intervention",
  error: string,
  params: T,
  attemptCount: number,
  functionName: string
}
```

This payload defines exactly what a human can see and edit.

---

## Usage Patterns (and Tradeoffs)

### 1. Closure-Captured Call (Minimal)

```ts
const llmCall = async () => { ... };
retryLlmCall(llmCall, undefined);
```

**Pros**

* Simple
* No binding issues

**Cons**

* No correctable params
* Interrupt can only “retry or cancel”

**Use when**

* There is nothing meaningful to tweak

---

### 2. Bound Method (`.bind`) — ⚠️ Discouraged

```ts
retryLlmCall(
  model.generateContent.bind(model),
  params
);
```

**Pros**

* Works with SDK methods
* Params are visible

**Cons**

* Function identity is obscured
* Semantic meaning of params is unclear
* Encourages in-place mutation
* Harder to reason about in graphs

**Rule**

> Mechanically valid, architecturally weak.

---

### 3. Thin Wrapper Lambda (Partial Exposure)

```ts
(prompt) => executeGenerateImage(prompt, ...)
```

**Pros**

* Clean
* Strong typing
* No binding hazards

**Cons**

* Only `prompt` is correctable
* Captured inputs cannot be fixed

**Use when**

* Only one value should evolve (e.g. prompt sanitization)

---

## ✅ Recommended Pattern (Best Practice)

### Principle

> **If a human might say “let me tweak that”, it must be in `params`.**

---

### Example

```ts
type ImageGenRetryParams = {
  prompt: string;
  model: string;
  seed: number;
  outputMimeType: string;
};

const generateImage = async (params: ImageGenRetryParams) => {
  return imageModel.generateContent({
    model: params.model,
    contents: [params.prompt],
    config: {
      seed: params.seed,
      imageConfig: {
        outputMimeType: params.outputMimeType,
      },
    },
  });
};

await retryLlmCall(
  generateImage,
  {
    prompt,
    model: "imagen-3.0",
    seed: 12345,
    outputMimeType: "image/png",
  },
  {},
  async (error, attempt, params) => {
    if (error.message.includes("Resource exhausted")) {
      return { ...params, model: "imagen-4.0" };
    }
  }
);
```

---

## Design Rules (Non-Negotiable)

1. **Retry params define the human contract**
2. **Do not mutate captured state**
3. **Do not mutate params in place**
4. **Prefer explicit param objects**
5. **Avoid `.bind` unless unavoidable**
6. **Retries must be replayable**

---

## What You Do *Not* Need to Change

You **do not need to revise `retryLlmCall`** to enable more correction.

You only revise:

* the **shape of `params`**
* what you choose to expose as retry-relevant

That separation is intentional and foundational.

---

## Summary

`retryLlmCall` is not just a retry helper.
It is a **human–model interface boundary**.

Design that boundary carefully, and everything downstream becomes clearer, safer, and easier to evolve.
