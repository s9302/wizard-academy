// The academy's four houses. Each has a common room at the top of one of
// the academy's corner towers (levels/academyHouses.ts); join one there and
// its crest goes on your robe.

export type HouseId = "liondor" | "snakerins" | "ravenhand" | "simpletonpuff";
export type Emblem = "lion" | "snake" | "eagle" | "badger";

export type House = { name: string; color: string; trim: string; emblem: Emblem; motto: string };

export const HOUSES: Record<HouseId, House> = {
  liondor: { name: "Liondor", color: "#a8283a", trim: "#e8c547", emblem: "lion", motto: "Bold of heart, loud of voice" },
  snakerins: { name: "Snakerins", color: "#1f7a3f", trim: "#c9ccd8", emblem: "snake", motto: "Patience is a sharper fang" },
  ravenhand: { name: "Ravenhand", color: "#1f4f9e", trim: "#c08a4a", emblem: "eagle", motto: "Wit soars highest" },
  simpletonpuff: { name: "Simpletonpuff", color: "#e0b52a", trim: "#2a2230", emblem: "badger", motto: "Kind, loyal, and probably snacking" },
};

export const HOUSE_IDS = Object.keys(HOUSES) as HouseId[];
export const isHouse = (v: unknown): v is HouseId => typeof v === "string" && v in HOUSES;
