/**
 * In-memory decision log. Enough to replay a trace and to export the
 * clarification records a later training loop would consume. Injection
 * events store a label, not the raw payload.
 */
export class Telemetry {
  constructor() {
    this.events = [];
  }

  record(name, fields = {}) {
    const event = { name, at: new Date().toISOString(), ...fields };
    this.events.push(event);
    return event;
  }

  replay(traceId) {
    return this.events.filter((event) => event.traceId === traceId || event.contractId);
  }

  forTrace(traceId) {
    return this.events.filter((event) => event.traceId === traceId);
  }

  learningExport() {
    return this.events.filter((event) =>
      ["scout.clarification", "scout.override", "contract.refused"].includes(event.name),
    );
  }
}
