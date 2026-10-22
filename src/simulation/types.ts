import type { BuildingKind, Resource, Stock, TechId } from "./catalog";
export interface Point {
  x: number;
  z: number;
}
export interface Building extends Point {
  id: number;
  kind: BuildingKind;
  /** Quarter-turns around +Y: 0 south (+Z), 1 east (+X), 2 north, 3 west. */
  rotation: number;
  progress: number;
}
export interface ResourceNode extends Point {
  id: number;
  kind: "wood" | "food" | "stone";
  amount: number;
  variant: number;
}
export type Order =
  | { type: "auto" }
  | { type: "idle" }
  | { type: "move"; target: Point }
  | { type: "gather"; target: number }
  | { type: "build"; target: number }
  | { type: "work"; target: number };
export interface Villager extends Point {
  id: number;
  name: string;
  order: Order;
  auto: boolean;
  path: Point[];
  task: string;
  cargo: { kind: Resource; amount: number } | null;
  action: number;
  morale: number;
  destination?: number;
  blocked: number;
}
export interface Relationship {
  a: number;
  b: number;
  affinity: number;
  trust: number;
  encounters: number;
  lastTick: number;
}
export interface World {
  version: 1;
  seed: number;
  rng: number;
  tick: number;
  nextId: number;
  size: number;
  terrain: number[];
  stock: Stock;
  buildings: Building[];
  nodes: ResourceNode[];
  villagers: Villager[];
  roads: number[];
  bridges: number[];
  techs: TechId[];
  research: { id: TechId; progress: number } | null;
  recruit: number | null;
  /** Paid, identical villager orders waiting behind the active welcome, in FIFO order. */
  recruitQueue: number;
  relationships: Record<string, Relationship>;
  log: { tick: number; text: string }[];
  config: { maxPopulation: number; foodConsumption: number };
  scenario: { id: "freeform"; flags: Record<string, boolean> };
}
export type Command =
  | {
      type: "place";
      kind: BuildingKind;
      x: number;
      z: number;
      rotation: number;
      villagers: number[];
    }
  | { type: "order"; ids: number[]; order: Order }
  | { type: "auto"; ids: number[]; enabled: boolean }
  | { type: "research"; id: TechId }
  | { type: "recruit" }
  | { type: "demolish"; id: number }
  | { type: "removePath"; x: number; z: number }
  | { type: "config"; maxPopulation: number };
export interface CommandResult {
  ok: boolean;
  message?: string;
}
