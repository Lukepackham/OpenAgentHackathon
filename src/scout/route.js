/**
 * Turn an intent's abstract capabilities into an ordered tool plan.
 * Selection order: permission, availability, surface, cost/latency, then local-first.
 * A capability with no usable tool is reported. It is never replaced with an
 * out-of-scope tool.
 */
export function buildToolPlan({ intent, graph, user, surface, parameters, prompt }) {
  const steps = [];
  const missing = [];

  for (const capability of intent.capabilities ?? []) {
    const tools = graph[capability] ?? [];
    const chosen = selectTool(tools, { user, surface });
    if (!chosen) {
      missing.push(capability);
      continue;
    }
    steps.push({
      capability,
      tool: chosen.toolId,
      input: { ...parameters, prompt },
    });
  }

  return { steps, missing };
}

function selectTool(tools, { user, surface }) {
  const role = user?.role ?? "anonymous";
  const permitted = tools.filter((tool) => {
    if (!tool.permissions?.length) return true;
    const grants = new Set(user?.permissions ?? []);
    if (role === "admin") return true;
    return tool.permissions.every((permission) => grants.has(permission));
  });
  const available = permitted.filter((tool) => tool.available !== false);
  if (!available.length) return null;

  const preferred = available.filter((tool) => !tool.surfaces || tool.surfaces.includes("*") || tool.surfaces.includes(surface));
  const pool = preferred.length ? preferred : available;
  return [...pool].sort((a, b) => {
    if (Boolean(b.local) !== Boolean(a.local)) return Number(b.local) - Number(a.local);
    return (a.latencyMs ?? 0) - (b.latencyMs ?? 0) || (a.cost ?? 0) - (b.cost ?? 0);
  })[0];
}
