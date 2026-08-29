export class SiemDomController {
  constructor(adapter, features = [], { debounceMs = 100 } = {}) {
    this.adapter = adapter;
    this.features = features;
    this.debounceMs = debounceMs;
    this.observer = null;
    this.timer = null;
    this.lastUuid = null;
    this.pendingRecords = [];
    this.observedRoots = new WeakSet();
  }

  start() {
    this.stop();
    const root = this.adapter.getRoot();
    if (!root) return false;
    this.observer = new MutationObserver((records) => {
      const relevant = this.adapter.filterMutationRecords?.(records) ?? records;
      if (relevant.length) this.schedule(relevant);
    });
    this.observeRoots();
    for (const feature of this.features) feature.mount?.({ adapter: this.adapter, root });
    this.schedule();
    return true;
  }

  observeRoots() {
    for (const root of this.adapter.getObservationRoots?.() ?? [this.adapter.getRoot()]) {
      if (!root || this.observedRoots.has(root)) continue;
      try {
        this.observer.observe(root, { childList: true, subtree: true });
        this.observedRoots.add(root);
      } catch { /* A detached legacy frame can disappear between discovery and observe(). */ }
    }
  }

  schedule(records = []) {
    this.pendingRecords.push(...records);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush() {
    const records = this.pendingRecords.splice(0);
    this.adapter.refreshFieldRoots?.(records);
    this.observeRoots();
    const uuid = this.adapter.getEventUuid();
    const event = this.adapter.extractEvent();
    for (const feature of this.features) feature.onDomChanged?.({ event, adapter: this.adapter });
    if (uuid !== this.lastUuid) {
      this.lastUuid = uuid;
      for (const feature of this.features) feature.onEventChanged?.({ event, adapter: this.adapter });
    }
  }

  reconnect() { return this.start(); }

  stop() {
    clearTimeout(this.timer);
    this.observer?.disconnect();
    this.observer = null;
    this.observedRoots = new WeakSet();
    this.pendingRecords = [];
    for (const feature of this.features) feature.unmount?.();
  }
}
