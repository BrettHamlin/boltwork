/**
 * Wave Planning
 *
 * Compute execution waves from task groups using topological sort.
 * Minds with no dependencies go in wave 1. Minds that depend on wave 1
 * minds go in wave 2. And so on.
 */

import type { TaskGroup, Wave } from "../types.ts";

/**
 * Compute execution waves from task groups.
 * Uses Kahn's algorithm for topological sort.
 *
 * Returns waves where all minds in a wave can execute in parallel.
 */
export function computeWaves(groups: TaskGroup[]): Wave[] {
  // Build adjacency map and in-degree count
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // mind → minds that depend on it

  for (const group of groups) {
    if (!inDegree.has(group.mind)) inDegree.set(group.mind, 0);
    for (const dep of group.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(group.mind);
      inDegree.set(group.mind, (inDegree.get(group.mind) ?? 0) + 1);
    }
  }

  // Kahn's algorithm
  const waves: Wave[] = [];
  const ready = new Set(
    [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([name]) => name),
  );

  let waveNum = 0;
  while (ready.size > 0) {
    waveNum++;
    const wave: Wave = {
      id: `wave-${waveNum}`,
      minds: [...ready].sort(), // deterministic order
    };
    waves.push(wave);

    const nextReady = new Set<string>();
    for (const mind of ready) {
      for (const dependent of dependents.get(mind) ?? []) {
        const newDeg = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) nextReady.add(dependent);
      }
    }

    ready.clear();
    for (const m of nextReady) ready.add(m);
  }

  // Check for cycles
  const planned = new Set(waves.flatMap((w) => w.minds));
  const all = new Set(groups.map((g) => g.mind));
  const missing = [...all].filter((m) => !planned.has(m));
  if (missing.length > 0) {
    throw new Error(`Dependency cycle detected involving: ${missing.join(", ")}`);
  }

  return waves;
}
