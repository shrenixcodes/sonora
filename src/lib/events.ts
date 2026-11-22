/**
 * Lightweight, type-safe event emitter for Sonora.
 */

type Listener<T = any> = (data: T) => void;

export class EventEmitter<Events extends Record<string, any>> {
  private listeners: { [K in keyof Events]?: Array<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(listener);

    return () => {
      this.off(event, listener);
    };
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const wrapper: Listener<Events[K]> = (data: Events[K]) => {
      this.off(event, wrapper);
      listener(data);
    };
    return this.on(event, wrapper);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const list = this.listeners[event];
    if (!list) return;
    const index = list.indexOf(listener);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const list = this.listeners[event];
    if (!list) return;
    const copy = [...list];
    for (const listener of copy) {
      try {
        listener(data);
      } catch (err) {
        console.error(`[EventEmitter] Error handling event "${String(event)}":`, err);
      }
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
