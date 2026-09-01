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
    this.focusRoots = new Set();
    this.handleFocus = () => this.flush();
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
      if (!this.focusRoots.has(root)) {
        root.addEventListener?.("focusin", this.handleFocus, true);
        this.focusRoots.add(root);
      }
    }
  }

  schedule(records = []) {
    this.pendingRecords.push(...records);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
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
    for (const root of this.focusRoots) root.removeEventListener?.("focusin", this.handleFocus, true);
    this.focusRoots.clear();
    this.pendingRecords = [];
    for (const feature of this.features) feature.unmount?.();
  }
}
