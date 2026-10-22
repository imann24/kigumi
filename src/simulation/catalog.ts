export type Resource = "wood" | "food" | "stone" | "insight";
export type Stock = Record<Resource, number>;
export type BuildingKind =
  | "hall"
  | "house"
  | "store"
  | "farm"
  | "workshop"
  | "tea"
  | "shrine"
  | "road"
  | "bridge";
export type TechId =
  "joinery" | "agriculture" | "wheelbarrow" | "community" | "craft";
export interface BuildingDef {
  name: string;
  subtitle: string;
  description: string;
  size: [number, number];
  cost: Partial<Stock>;
  work: number;
  category: "village" | "production" | "paths";
  capacity?: number;
  tech?: TechId;
}
export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  hall: {
    name: "Village hall",
    subtitle: "The heart of the village",
    description:
      "A gathering place, storehouse and home for your first eight villagers. Produces insight for research.",
    size: [4, 4],
    cost: { wood: 180, stone: 70 },
    work: 100,
    category: "village",
    capacity: 8,
  },
  house: {
    name: "Minka house",
    subtitle: "Room to put down roots",
    description:
      "A timber home for six villagers. Build near work and shared spaces to keep your village connected.",
    size: [3, 2],
    cost: { wood: 45, stone: 8 },
    work: 24,
    category: "village",
    capacity: 6,
  },
  store: {
    name: "Storehouse",
    subtitle: "A shorter journey home",
    description:
      "Villagers deliver wood, food and stone here. Shorter hauling routes mean more time gathering.",
    size: [2, 2],
    cost: { wood: 35, stone: 5 },
    work: 20,
    category: "production",
  },
  farm: {
    name: "Rice paddy",
    subtitle: "A little patience, a harvest",
    description:
      "A renewable food source for up to three assigned villagers. Requires an open route to a storehouse.",
    size: [3, 3],
    cost: { wood: 30 },
    work: 18,
    category: "production",
  },
  workshop: {
    name: "Workshop",
    subtitle: "Good things, made well",
    description:
      "Assign up to two craftspeople to produce insight. Unlocks more advanced research.",
    size: [3, 2],
    cost: { wood: 65, stone: 25 },
    work: 35,
    category: "production",
    tech: "joinery",
  },
  tea: {
    name: "Tea house",
    subtitle: "Make time for each other",
    description:
      "Nearby villagers feel more at home. Encounters within six tiles form stronger bonds.",
    size: [3, 2],
    cost: { wood: 70, stone: 15 },
    work: 30,
    category: "village",
    tech: "community",
  },
  shrine: {
    name: "Garden shrine",
    subtitle: "A quiet place to belong",
    description:
      "A small garden that lifts morale within six tiles. No worker assignment required.",
    size: [2, 2],
    cost: { wood: 40, stone: 40 },
    work: 26,
    category: "village",
    tech: "community",
  },
  road: {
    name: "Stone path",
    subtitle: "Connect the everyday",
    description:
      "Walking is 45% faster on paths. Drag to lay a connected route; paths cannot cross buildings.",
    size: [1, 1],
    cost: { stone: 1 },
    work: 0,
    category: "paths",
  },
  bridge: {
    name: "Timber bridge",
    subtitle: "Find the other bank",
    description:
      "Place a bridge tile on water. Connect tiles from bank to bank to open a crossing.",
    size: [1, 1],
    cost: { wood: 6 },
    work: 0,
    category: "paths",
  },
};
export const TECHS: Record<
  TechId,
  {
    name: string;
    description: string;
    cost: Partial<Stock>;
    duration: number;
    requires: TechId[];
    building?: BuildingKind;
  }
> = {
  joinery: {
    name: "Timber joinery",
    description: "Unlock workshops. Houses welcome two more villagers.",
    cost: { wood: 35, insight: 25 },
    duration: 30,
    requires: [],
  },
  agriculture: {
    name: "Careful cultivation",
    description: "Rice paddies produce 40% more food.",
    cost: { food: 40, insight: 30 },
    duration: 35,
    requires: [],
  },
  wheelbarrow: {
    name: "The wheelbarrow",
    description: "Carry 12 resources per trip instead of 8.",
    cost: { wood: 50, insight: 45 },
    duration: 40,
    requires: ["joinery"],
    building: "workshop",
  },
  community: {
    name: "Shared traditions",
    description: "Unlock tea houses and garden shrines.",
    cost: { food: 45, insight: 35 },
    duration: 35,
    requires: [],
  },
  craft: {
    name: "Master craftsmanship",
    description: "Gather and construct 30% faster.",
    cost: { wood: 70, stone: 30, insight: 80 },
    duration: 55,
    requires: ["joinery", "wheelbarrow"],
    building: "workshop",
  },
};
export const RECRUIT_COST = 35;
export const RECRUIT_DURATION = 12;
/** Total paid orders, including the active welcome. */
export const RECRUIT_QUEUE_LIMIT = 20;

export const RESOURCE_LABEL: Record<Resource, string> = {
  wood: "Timber",
  food: "Food",
  stone: "Stone",
  insight: "Insight",
};
