/** Phân loại vật phẩm CS2 theo market_hash_name (không cần gọi thêm API). */
export type Category =
  | "knife"
  | "gloves"
  | "rifle"
  | "sniper"
  | "pistol"
  | "smg"
  | "shotgun"
  | "machinegun"
  | "other";

export const CATEGORY_LABELS: Record<Category, string> = {
  knife: "Dao",
  gloves: "Găng tay",
  rifle: "Súng trường",
  sniper: "Súng ngắm",
  pistol: "Súng lục",
  smg: "Tiểu liên",
  shotgun: "Shotgun",
  machinegun: "Súng máy",
  other: "Khác",
};

export const CATEGORY_ORDER: Category[] = [
  "knife",
  "gloves",
  "rifle",
  "sniper",
  "pistol",
  "smg",
  "shotgun",
  "machinegun",
  "other",
];

const RIFLES = new Set(["AK-47", "M4A4", "M4A1-S", "Galil AR", "FAMAS", "SG 553", "AUG"]);
const SNIPERS = new Set(["AWP", "SSG 08", "SCAR-20", "G3SG1"]);
const PISTOLS = new Set([
  "Glock-18",
  "USP-S",
  "P2000",
  "P250",
  "Five-SeveN",
  "Tec-9",
  "CZ75-Auto",
  "Desert Eagle",
  "R8 Revolver",
  "Dual Berettas",
]);
const SMGS = new Set(["MP9", "MAC-10", "MP7", "MP5-SD", "UMP-45", "P90", "PP-Bizon"]);
const SHOTGUNS = new Set(["Nova", "XM1014", "Sawed-Off", "MAG-7"]);
const MACHINE_GUNS = new Set(["M249", "Negev"]);
const GLOVE_RE = /gloves|hand wraps/i;

export function categoryOf(marketHashName: string): Category {
  let n = marketHashName.trim();
  const isStar = n.startsWith("★");
  n = n.replace(/^★\s*/, "").replace(/^(StatTrak™|Souvenir)\s+/, "");
  const base = n.split(" | ")[0].trim();

  // Dao và găng tay đều có dấu ★ ở đầu tên
  if (isStar) return GLOVE_RE.test(base) ? "gloves" : "knife";

  if (RIFLES.has(base)) return "rifle";
  if (SNIPERS.has(base)) return "sniper";
  if (PISTOLS.has(base)) return "pistol";
  if (SMGS.has(base)) return "smg";
  if (SHOTGUNS.has(base)) return "shotgun";
  if (MACHINE_GUNS.has(base)) return "machinegun";
  return "other";
}
