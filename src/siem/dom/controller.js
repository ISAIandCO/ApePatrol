export class SiemDomController {
  constructor(adapter, features = [], { debounceMs = 100 } = {}) {
    this.adapter = adapter;
    this.features = features;
    this.debounceMs = debounceMs;
    this.observer = null;
    this.timer = null;
    this.lastUuid = null;
  }

  start() {
    this.stop();
    const root = this.adapter.getRoot();
    if (!root) return false;
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(root, { childList: true, subtree: true });
    for (const feature of this.features) feature.mount?.({ adapter: this.adapter, root });
    this.schedule();
    return true;
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush() {
    this.adapter.refreshFieldRoots?.();
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
    for (const feature of this.features) feature.unmount?.();
  }
}
