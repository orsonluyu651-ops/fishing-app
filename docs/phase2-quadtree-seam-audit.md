# Step B — Algorithmic Audit & Quadtree Interface Seam Analysis

> **Archived:** 2026-09-22 · **Baseline:** commit `85da828` · **Targets:** `src/lib/mapClusterEngine.ts` (186 L), `src/components/FishloreMap.tsx`
> **Audit constraint honored:** zero logic deviations — no production file touched. This document is analysis only.

---

## Task 1 — Big-O & Signature Complexity Audit

### 1.1 Structural type inventory (`mapClusterEngine.ts`)

| Type | Kind | Role | Consumer coupling |
|---|---|---|---|
| `MapClusterNode` | interface | **Legacy** display node (`isCluster`, `name`) — emitted only by `clusterMarkersByGrid` | Backward-compat surface only |
| `GeoPoint` | interface | Raw catch coordinate (`id`, `lat`, `lng`, `species`) | Input contract of `computeSpatialClusters` |
| `MapCluster` | interface | Density cluster (`pointCount`, `expansionZoom`, `containsIds`) | Output union member |
| `SpatialBoundingBox` | tuple `[minLng, minLat, maxLng, maxLat]` | Viewport bounds — **note the lng-first field order**, unlike the lat/lng convention elsewhere in the app | Must be preserved verbatim through any quadtree query layer |
| `isClusterNode(v)` | exported type guard | Narrows `GeoPoint \| MapCluster` via `pointCount` + `containsIds` duck-check (O(1)) | Used by both test files; **primary structural contract to protect** |

Private helpers (all O(1)): `clampZoom` (floor + clamp 0–22, `NaN→0`), `cellSizeForZoom` (8° / 2^zoom — cell halves per zoom step), `isInsideBox` (inclusive bounds).

### 1.2 Computational complexity indices

| Function | Lines | Complexity | Verdict |
|---|---|---|---|
| `computeSpatialClusters(points, bbox, zoom)` | 85–125 | **O(n) time / O(n) space** — single pass: validity guard (L98) → bbox filter (L99) → string-key bucket `floor(lat/cell):floor(lng/cell)` (L100–104) → single emit pass over cells (L107–123). Centroid `reduce`s iterate bucket members whose union is exactly n. | **Already at the O(n) optimal threshold.** No O(n²) drift. The string-key Map is effectively a flat spatial hash. |
| `clusterMarkersByGrid(spots, gridRes)` | 134–186 | **O(n²) worst case** (fully-packed grid → full pairwise sweep; O(n·k̄) typical), O(n) space via `processedIndices` set. | **The legacy O(n²) island.** Self-documented (L132) as legacy + pointer to `computeSpatialClusters`. |

**Critical consumer fact:** repo-wide, `mapClusterEngine` is imported **only by test files** (`mapClusterEngine.test.ts`, `performanceProfiler.test.ts`). `clusterMarkersByGrid` has **zero production call sites** — it is a pure backward-compatibility contract surface. FishloreMap.tsx does **not** consume the clustering engine at all today.

### 1.3 Fallback guards & backward-compat verification

| Guard | Location | Status |
|---|---|---|
| null/undefined array rejection | `computeSpatialClusters` L90–91; `clusterMarkersByGrid` L135 | ✅ present, test-covered (L131–135 / L36–39) |
| Non-finite coordinate skip | L98 (`Number.isFinite` ×2) | ✅ present, silently drops bad points |
| Degenerate bbox (`length !== 4`) | L91 | ✅ returns `[]` |
| Zoom domain escape (NaN, <0, >22, fractional) | `clampZoom` L41–44 | ✅ floor+clamp, NaN→0 |
| Type-guard duck narrow | `isClusterNode` L62–67 | ✅ exported; brittle `(value as MapCluster)` double-cast — a `kind: 'cluster'` discriminant field would be strictly safer; **non-blocking** |
| Legacy shape preservation | `MapClusterNode` + `clusterMarkersByGrid` | ✅ intact; any quadtree refactor must not delete these |
| Deterministic cluster identity | L115: `id = cluster_` + **sorted** joined ids | ✅ order-independent id — output **array order** is cell-insertion-order (documented L82), but ids are stable under reordering |
---

## Task 2 — Quadtree Quadrant Seam Isolation

### 2.1 Viewport coordinate entry points (where global data meets the map)

`FishloreMap.tsx` currently renders **3 static `HOTSPOTS`** (L43–47) and never enters the clustering pipeline. The precise execution hooks a quadtree plugs into are already present:

| Hook | Location | Function today | Quadtree role tomorrow |
|---|---|---|---|
| `onRegionChangeComplete={handleRegionChangeComplete}` | L216 | Debounced tile prefetch trigger (1.5 s) | **Primary viewport query trigger** — fire `queryViewport(tree, bbox)` per settle |
| `zoomForRegion(region)` | imported from `mapTileCache` | Chooses cache zoom band | Supplies tree query depth band |
| `regionToBbox(region, 2)` | imported from `mapTileCache` | Expands region → bbox with margin | Already produces the exact `SpatialBoundingBox` a query consumes |
| `MIN_ZOOM` / `MAX_ZOOM` | imported constants | Tile bounds | Clamp for `expansionZoom` parity |

**The architectural win:** today `computeSpatialClusters` is *rebuild-per-call* — O(n) on every pan. A quadtree inverts this: **build once per dataset change** (O(n log n)), **query per pan** O(log n + k). The tree lives outside the component (module-level or `useRef`), keyed by dataset identity — the component only owns queries.

### 2.2 Structural signatures for the future quadtree node (design contract, not yet implemented)

```ts
/** Capacity marker: leaves split when pointCount exceeds this. */
const QUADTREE_NODE_CAPACITY = 8;          // 8–16 typical for lat/lng degree data

/** Depth marker: hard stop to bound recursion (bbox at depth 12 ≈ sub-meter cells). */
const QUADTREE_MAX_DEPTH = 12;

/** Recursive node: leaf while children === null. */
interface QuadtreeNode {
  bounds: SpatialBoundingBox;                              // same tuple contract as engine
  depth: number;                                           // 0..QUADTREE_MAX_DEPTH
  points: GeoPoint[];                                      // leaf payload; empty once subdivided
  children: [QuadtreeNode, QuadtreeNode, QuadtreeNode, QuadtreeNode] | null; // fixed NW,NE,SW,SE
}

interface QuadtreeIndex {
  root: QuadtreeNode;
  insert(p: GeoPoint): void;                               // O(log n) amortized
  queryViewport(box: SpatialBoundingBox, zoom: number): (GeoPoint | MapCluster)[]; // O(log n + k)
}
```

Sub-quadrant split rule (midpoint of node `bounds`, **not** centroid of points — keeps tree shape input-order-independent): NW `(midLng, midLat, maxLng, maxLat)` · NE `(midLng, minLat, maxLng, midLat)` · SW `(minLng, minLat, midLng, midLat)` · SE `(minLng, midLat, midLng, maxLat)`. Points exactly on a midline go to the lower/left quadrant (deterministic).

**Migration seam rule:** the quadtree query must emit the **same `GeoPoint | MapCluster` union** through the same exported `isClusterNode` guard, with cluster ids built by the same sorted-`containsIds` scheme (L115) — id stability makes the swap invisible to marker diffing.
### 2.3 `bestOfClusterProfile()` microbenchmark contract — safeguard parameters

Contract location: `performanceProfiler.test.ts` L87–98 (best-of-3 wrapper over `profileExecutionTime`). Its consumers hard-code these invariants; a quadtree transition must not perturb them:

| Invariant | Value | Safeguard |
|---|---|---|
| Signature | `bestOfClusterProfile(label, fn, attempts = 3)` | **Do not fork it.** New quadtree benchmarks call this same function; never a parallel implementation |
| Structured payload keys | `['durationMs', 'label', 'result']` exactly (L159) | New metrics reuse the `ExecutionProfile` shape |
| Total metric count | `metrics).toHaveLength(6)` (L156) | **New quadtree benchmarks go in a new test file/describe** — do not append entries to the existing 6-metric payload |
| Cluster metric count | `clusterMetrics).toHaveLength(4)` (L163) — labels containing "cluster" | Name benchmarks carefully (e.g. `quadtree-query-z8`); if a label contains "cluster" it must live in the new file |
| Frame budget | `maxClusterMs: 16` @ 1,000 points (L165) | Quadtree **build** may exceed; the **query** must meet 16 ms @ 1k — benchmark the query path, amortize the build |
| Heap allowance | `maxHeapGrowthBytes: 20 MB` (L166) | Tree allocation must stay under; reuse `captureMemorySnapshot` / `evaluatePerformanceGating` |
| Timing hygiene | JIT warm-up before timing (L111) | New benchmark files replicate warm-up + best-of-3 via `bestOfClusterProfile` |
| Semantic equivalence | — | New test: `queryViewport(tree, box, z)` set-equals `computeSpatialClusters(points, box, z)` partition (same `containsIds` grouping) at matched granularity; order-agnostic assertions only (existing tests use `find`/`some`, never index) |

---

## Gating Verification

- Zero logic deviations: no production file modified in this audit (doc-only change).
- `npx tsc --noEmit` → TS_EXIT_0.
- `npx jest --silent` → 34 suites / 245 tests green (repo-tracked hook re-enforces on commit).





### 1.4 Latent edge notes (non-blocking, for the quadtree implementation phase)

- `Math.floor(lat/cell)` handles negative hemispheres correctly (floor toward −∞) — uniform cells globally. **Antimeridian wrap is NOT handled** (|lng| > 180 points silently drop via bbox filter).
- Degenerate box (min > max) yields `[]` silently — no explicit test asserts this; add one when touching the seam.
- z=22 cell ≈ 1.9×10⁻⁶° — float-key granularity edge; `clampZoom`'s cap is the real protection.
- `FishloreMap.tsx` L76: `statusTimerRef` indentation anomaly (cosmetic only).
