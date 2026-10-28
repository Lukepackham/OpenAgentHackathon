/**
 * Pick a model profile that is cleared for the data class.
 * Confidential data stays on a local profile. High-risk work prefers the
 * more capable local profile. Ties break toward local, then lower latency.
 */
export function chooseModelProfile({ profiles, dataClass, riskClass }) {
  const list = profiles.profiles ?? profiles;
  const cleared = list.filter((profile) => profile.dataClasses?.includes(dataClass));
  if (!cleared.length) {
    throw new Error(`No model profile is cleared for data class ${dataClass}.`);
  }

  const ranked = [...cleared].sort((a, b) => {
    if (dataClass === "confidential" || dataClass === "restricted") {
      if (Boolean(b.local) !== Boolean(a.local)) return Number(b.local) - Number(a.local);
    }
    if (riskClass === "high" && Boolean(b.local) !== Boolean(a.local)) {
      return Number(b.local) - Number(a.local);
    }
    if (riskClass === "high") return (b.context ?? 0) - (a.context ?? 0);
    return (a.latency?.p95Ms ?? 0) - (b.latency?.p95Ms ?? 0);
  });

  const winner = ranked[0];
  return { id: winner.id, provider: winner.provider, model: winner.model };
}
