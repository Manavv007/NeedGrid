import { NEED_UPDATED_EVENT, type NeedCard } from "@needgrid/shared";
import { act } from "@testing-library/react";
import { vi } from "vitest";
import { mockDb } from "@/mocks/mockDb";

/**
 * Stands in for the browser's EventSource (jsdom has none). Tests drive it: `open()` when the
 * server accepts the stream, `emit()` for an event, `fail()` for a dropped connection (the browser
 * retries) or `fail({ permanent: true })` for a refused one (404: the browser gives up).
 */
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly withCredentials = false;
  readyState: number = FakeEventSource.CONNECTING;
  closed = false;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.closed = true;
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emit(type: string, data: string): void {
    if (this.closed) return;
    this.dispatchEvent(new MessageEvent(type, { data }));
  }

  fail({ permanent = false } = {}): void {
    this.readyState = permanent ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.dispatchEvent(new Event("error"));
  }
}

/** Call in beforeEach; undo with `vi.unstubAllGlobals()`. */
export function installFakeEventSource(): void {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
}

/** The one stream the page opened. */
export function onlyStream(): FakeEventSource {
  const [source, ...others] = FakeEventSource.instances;
  if (!source || others.length > 0)
    throw new Error(`expected 1 EventSource, found ${FakeEventSource.instances.length}`);
  return source;
}

/** A `need.updated` event as the API writes it (data = the card's JSON). */
export function sendNeedUpdate(card: NeedCard, source: FakeEventSource = onlyStream()): void {
  act(() => source.emit(NEED_UPDATED_EVENT, JSON.stringify(card)));
}

/** A public card from the mock API's fixtures, to build updates from. */
export function fixtureCard(slug: string, id: string): NeedCard {
  const card = mockDb.getOrgPage(slug)?.needs.find((need) => need.id === id);
  if (!card) throw new Error(`no public fixture need ${id} at ${slug}`);
  return card;
}
