# Embedding Backend Comparison Note

## Current KanQual Approach

KanQual currently generates local project embeddings inside the Tauri/Rust app process using:

- `candle-core`
- `candle-nn`
- `candle-transformers`
- `tokenizers`

The relevant implementation lives in:

- [src-tauri/src/lib.rs](src-tauri/src/lib.rs)

Key characteristics of the current implementation:

- Uses `Device::Cpu`
- Loads `intfloat/multilingual-e5-large` directly from safetensors
- Builds one `LocalEmbeddingRuntime`
- Runs one `embed_text_batch(...)` call at a time
- Performs one serial `model.forward(...)` per batch
- Does not currently use a GPU backend
- Does not currently configure an optimized BLAS / inference backend
- Does not parallelize multiple embedding batches concurrently

Implications:

- Performance depends heavily on raw CPU inference speed in Candle
- Cancellation can only occur between batches
- Pre-run estimates are difficult because true throughput is device-specific and currently mostly serial at the expensive step

## What QualCoder Appears To Do

From upstream materials, QualCoder uses:

- `sentence-transformers`
- `transformers`
- PyTorch CPU wheels
- `faiss-cpu`
- a vector-store workflow

Sources checked:

- QualCoder requirements:
  - `https://raw.githubusercontent.com/ccbogel/QualCoder/master/requirements.txt`
- QualCoder AI setup docs:
  - `https://qualcoder.org/doc/en/2.3.-AI-Setup`
- QualCoder release notes:
  - `https://github.com/ccbogel/QualCoder/releases`

What this likely means in practice:

- QualCoder delegates embedding generation to the Python `sentence-transformers` stack
- PyTorch handles transformer inference with more mature CPU kernels
- Embeddings are written into a vector store rather than managed only as a custom JSON index
- The system is designed around incremental updates to AI data when documents are added, changed, or renamed

## Likely Reason QualCoder Feels Faster

The most likely cause is not a small batching trick.

The bigger difference is probably:

- **PyTorch + sentence-transformers CPU inference** vs
- **Candle CPU inference in a custom Rust path**

Even without CUDA, PyTorch often performs much better on CPU inference workloads because:

- kernels are more mature
- operator implementations are heavily optimized
- batching behavior is already tuned for common embedding use cases

So if QualCoder is substantially faster on the same model, the gap is likely architectural.

## Can KanQual Parallelize the Current Candle Path More?

Only a little, and probably not enough to erase the gap.

Potential small wins:

- parallelize lightweight preprocessing
- parallelize hashing or text preparation
- improve reuse detection
- tune batch sizes for responsiveness

But the main bottleneck is likely:

- `runtime.model.forward(...)`

Running multiple embedding batches at once with multiple model runtimes is not an obviously safe win because it may:

- consume a lot more memory
- oversubscribe CPU resources
- make total runtime worse

## Practical Options

### Option 1: Keep Candle for v0.9

Pros:

- no architecture change before launch
- stays self-contained in Rust/Tauri
- lowest short-term risk

Cons:

- likely slower than a PyTorch-based embedding backend
- limited cancellation responsiveness
- difficult to produce reliable pre-run estimates

Recommended if:

- the priority is launch stability, not maximum embedding speed

### Option 2: Improve the Candle Path Later

Possible areas to investigate:

- optimized CPU math backend support for Candle
- smaller / alternative embedding models
- more granular progress and checkpointing
- resumable indexing

Pros:

- preserves a Rust-native architecture

Cons:

- uncertain payoff
- likely more engineering effort than swapping to a mature embedding stack

### Option 3: Add a Python `sentence-transformers` Helper Backend

This would likely be the closest path to QualCoder-like behavior.

Possible design:

- keep the main app in Tauri/Rust
- spawn a Python helper process for embedding work
- use `sentence-transformers` to generate embeddings
- keep the existing KanQual project/index format initially
- later migrate to a proper vector store if desired

Pros:

- likely much better CPU embedding performance
- closer to the stack QualCoder appears to use
- can still keep KanQual’s UI and project model

Cons:

- Python runtime bundling/distribution complexity
- process management complexity
- more platform-specific packaging work

Recommended if:

- embedding performance becomes a major product bottleneck after v0.9

### Option 4: Full Embedding Backend Migration

This would mean:

- revisiting embedding generation
- revisiting index storage
- possibly adopting a vector store
- potentially redesigning incremental update logic

Pros:

- strongest long-term performance and architecture opportunity

Cons:

- too large for v0.9 stabilization

## Recommended Path

### For v0.9

Stay with the current Candle path and do only stabilization work:

- conservative estimates
- rolling ETA only after real progress begins
- smaller internal batch cap
- clearer cancellation messaging

### After v0.9

Run a controlled comparison on the same machine:

1. current KanQual Candle path
2. equivalent Python `sentence-transformers` path on `multilingual-e5-large`

If the Python path is dramatically faster, the best next move is probably:

- a Python helper embedding backend

not:

- trying to hand-optimize Candle inference loops locally

## Bottom Line

QualCoder’s speed advantage is likely due to using the Python `sentence-transformers` / PyTorch ecosystem rather than anything simple like “more threads.”

That means the most realistic way for KanQual to close the gap is probably a backend change, not just additional loop-level parallelization in the current Rust code.
