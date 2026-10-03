// Android's SharedPreferences and androidx.preference, reduced to what source settings use. The screen only records
// definitions; the app renders them in its own settings form and writes values back through the host.
import type { Host } from "./host.ts";

export class SharedPreferences {
  constructor(private readonly store: Host["prefs"]) {}
  contains(key: string) {
    return this.store.get(key) !== undefined;
  }
  getString(key: string, def: string | null = null): string | null {
    const v = this.store.get(key);
    return typeof v === "string" ? v : def;
  }
  getBoolean(key: string, def = false): boolean {
    const v = this.store.get(key);
    return typeof v === "boolean" ? v : def;
  }
  getInt(key: string, def = 0): number {
    const v = this.store.get(key);
    return typeof v === "number" ? v : def;
  }
  /** Numbers are JS numbers here, so a Long is stored like an Int. */
  getLong(key: string, def = 0): number {
    return this.getInt(key, def);
  }
  getStringSet(key: string, def: string[] = []): string[] {
    const v = this.store.get(key);
    return Array.isArray(v) ? (v as string[]) : def;
  }
  edit() {
    const store = this.store;
    const editor = {
      putString: (k: string, v: string) => (store.set(k, v), editor),
      putBoolean: (k: string, v: boolean) => (store.set(k, v), editor),
      putInt: (k: string, v: number) => (store.set(k, v), editor),
      putLong: (k: string, v: number) => (store.set(k, v), editor),
      putStringSet: (k: string, v: string[]) => (store.set(k, v), editor),
      remove: (k: string) => (store.set(k, undefined), editor),
      apply: () => undefined,
      commit: () => true,
    };
    return editor;
  }
}

export type PreferenceDef =
  | { type: "switch"; key: string; title: string; summary?: string; default: boolean }
  | { type: "list"; key: string; title: string; summary?: string; entries: string[]; entryValues: string[]; default?: string }
  | { type: "multilist"; key: string; title: string; summary?: string; entries: string[]; entryValues: string[]; default: string[] }
  | { type: "text"; key: string; title: string; summary?: string; default: string };

abstract class Preference<T> {
  key = "";
  title = "";
  summary = "";
  protected defaultValue?: T;
  constructor(_context?: unknown) {}
  setDefaultValue(v: T) {
    this.defaultValue = v;
  }
  abstract toDef(): PreferenceDef;
}
export class SwitchPreferenceCompat extends Preference<boolean> {
  toDef(): PreferenceDef {
    return { type: "switch", key: this.key, title: this.title, summary: this.summary || undefined, default: this.defaultValue ?? false };
  }
}
export class CheckBoxPreference extends SwitchPreferenceCompat {}
export class ListPreference extends Preference<string> {
  entries: string[] = [];
  entryValues: string[] = [];
  toDef(): PreferenceDef {
    return { type: "list", key: this.key, title: this.title, summary: this.summary || undefined, entries: this.entries, entryValues: this.entryValues, default: this.defaultValue };
  }
}
export class MultiSelectListPreference extends Preference<string[]> {
  entries: string[] = [];
  entryValues: string[] = [];
  toDef(): PreferenceDef {
    return { type: "multilist", key: this.key, title: this.title, summary: this.summary || undefined, entries: this.entries, entryValues: this.entryValues, default: this.defaultValue ?? [] };
  }
}
export class EditTextPreference extends Preference<string> {
  dialogTitle = "";
  toDef(): PreferenceDef {
    return { type: "text", key: this.key, title: this.title, summary: this.summary || undefined, default: this.defaultValue ?? "" };
  }
}

export class PreferenceScreen {
  readonly context = undefined;
  readonly items: PreferenceDef[] = [];
  addPreference(p: { toDef(): PreferenceDef }) {
    this.items.push(p.toDef());
    return true;
  }
}
