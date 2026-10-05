// What the hover panels say about each ability and weapon: the numbers come
// straight from abilities.ts, classes.ts and combat.ts, so they can't drift.

import {
  ABILITIES,
  type AbilityId,
  abilityLevel,
  AEGIS,
  BLINK_RANGE,
  CHAIN,
  CHARGE_DAMAGE,
  CHARGE_SLOW_MS,
  CHARGE_SPEED,
  CHARGE_TIME,
  CONJURE_RANGE,
  DECOYS,
  FLAMES,
  FORTIFY_FACTOR,
  FORTIFY_HEAL,
  GIANT,
  GLIDE,
  HEAL,
  HELLPIT,
  INVERT_RANGE,
  JUDGMENT,
  BARKSKIN,
  ENTANGLE,
  FLURRY,
  INNER_PEACE_HEAL,
  PALM,
  SUMMON_LIMIT,
  WINDSTEP_SPEED,
  ASCEND,
  ASSASSINATE,
  BLACKHOLE,
  CYCLONE,
  DRAGON,
  EARTHSHATTER,
  FROSTNOVA,
  GUARDIAN,
  HOLYNOVA,
  HUNDREDFISTS,
  KNIVES,
  METEOR,
  PHANTOM,
  THORNSTORM,
  WARCRY,
  WHIRLWIND,
  WILDHUNT,
  WRATH,
  NULLZONE_RADIUS,
  PILLAR_HEIGHT,
  SANCTUARY,
  SHOCKWAVE,
  SMITE,
  SMOKE_RADIUS,
  TORNADO,
  WALL_SIZE,
} from "./abilities.ts";
import { WEAPONS, type WeaponId } from "./classes.ts";
import { SPELLS } from "./combat.ts";

export type Info = { title: string; lines: [string, string][]; text: string };

const s = (ms: number) => `${Math.round(ms / 100) / 10} s`;
const pct = (f: number) => `${Math.round(f * 100)}%`;

// [label, value] rows per ability, besides cooldown and unlock level.
const ROWS: Record<AbilityId, [string, string][]> = {
  wall: [["Size", `${WALL_SIZE[0]} x ${WALL_SIZE[1]} m`], ["Range", `${CONJURE_RANGE} m`], ["Lasts", s(ABILITIES.wall.durationMs!)]],
  pillar: [["Height", `${PILLAR_HEIGHT} m`], ["Range", `${CONJURE_RANGE} m`], ["Lasts", s(ABILITIES.pillar.durationMs!)]],
  blink: [["Range", `${BLINK_RANGE} m`], ["Effect", "Teleport; not through walls"]],
  stealth: [["Lasts", s(ABILITIES.stealth.durationMs!)], ["Effect", "Invisible until you attack"]],
  charge: [["Distance", `${Math.round(CHARGE_SPEED * CHARGE_TIME)} m`], ["Damage", `${CHARGE_DAMAGE} to everyone in the path`], ["Effect", `Shoved aside, slowed ${s(CHARGE_SLOW_MS)}`]],
  fortify: [["Lasts", s(ABILITIES.fortify.durationMs!)], ["Damage taken", pct(FORTIFY_FACTOR)], ["Heal", `${FORTIFY_HEAL}`], ["Effect", "Can't be slowed or knocked back"]],
  tornado: [["Damage", `${TORNADO.damage}`], ["Width", `${TORNADO.radius * 2} m`], ["Range", `${TORNADO.range} m`], ["Effect", "Catches enemies and monsters, carries and spins them, then flings them"]],
  flames: [["Damage", `${FLAMES.dps} per second`], ["Size", `${FLAMES.length} m line`], ["Lasts", s(ABILITIES.flames.durationMs!)]],
  hellpit: [["Damage", `${HELLPIT.dps} per second`], ["Radius", `${HELLPIT.radius} m`], ["Lasts", s(ABILITIES.hellpit.durationMs!)], ["Effect", "Drags enemies in and slows them"]],
  invert: [["Range", `${INVERT_RANGE} m`], ["Lasts", s(ABILITIES.invert.durationMs!)], ["Effect", "Their screen turns upside down"]],
  shockwave: [["Damage", `${SHOCKWAVE.damage}`], ["Radius", `${SHOCKWAVE.radius} m`], ["Effect", "Throws enemies and monsters away from you"]],
  nullzone: [["Radius", `${NULLZONE_RADIUS} m`], ["Lasts", s(ABILITIES.nullzone.durationMs!)], ["Effect", "No ranged attacks, and no magic reaches anyone inside (even from outside); breaks up Tornadoes"]],
  giant: [["Lasts", s(ABILITIES.giant.durationMs!)], ["Melee", `x${GIANT.damage} damage, x${GIANT.reach} reach`], ["Damage taken", pct(GIANT.taken)]],
  chain: [["Range", `${CHAIN.range} m`], ["Damage", `${CHAIN.damage}`], ["Effect", "Drags them to you"]],
  decoys: [["Copies", `${DECOYS.count}`], ["Lasts", s(ABILITIES.decoys.durationMs!)], ["Effect", "Fool players, bots and monsters; one hit breaks one"]],
  glide: [["Lasts", s(ABILITIES.glide.durationMs!)], ["Speed", `x${GLIDE.speed}`], ["Effect", "Leap up, fall slowly, no fall damage"]],
  smoke: [["Radius", `${SMOKE_RADIUS} m`], ["Lasts", s(ABILITIES.smoke.durationMs!)], ["Effect", "Anyone inside is hidden"]],
  heal: [["Heal", `${HEAL.amount}`], ["Radius", `${HEAL.radius} m (teammates)`]],
  smite: [["Damage", `${SMITE.damage} within ${SMITE.radius} m`], ["Range", `${SMITE.range} m`], ["Delay", s(SMITE.delayMs)], ["Effect", `Slowed ${s(SMITE.slowMs)}`]],
  sanctuary: [["Heal", `${SANCTUARY.hps} per second`], ["Radius", `${SANCTUARY.radius} m`], ["Lasts", s(ABILITIES.sanctuary.durationMs!)]],
  aegis: [["Shield", `${AEGIS.shield}`], ["Range", `${AEGIS.range} m`], ["Effect", "On the teammate you aim at, or you"]],
  judgment: [["Range", `${JUDGMENT.range} m`], ["Lasts", s(ABILITIES.judgment.durationMs!)], ["Effect", `Takes ${pct(JUDGMENT.factor - 1)} more damage`]],
  wolf: [["Ally", "Shadow wolf"], ["Lasts", s(ABILITIES.wolf.durationMs!)], ["Limit", `${SUMMON_LIMIT} beasts at once`]],
  entangle: [["Range", `${ENTANGLE.range} m`], ["Radius", `${ENTANGLE.radius} m`], ["Damage", `${ENTANGLE.dps} per second`], ["Effect", `Slowed to ${pct(ENTANGLE.slow)}`]],
  golem: [["Ally", "Stone golem"], ["Lasts", s(ABILITIES.golem.durationMs!)]],
  swarm: [["Allies", "3 fire imps (ranged)"], ["Lasts", s(ABILITIES.swarm.durationMs!)]],
  barkskin: [["Lasts", s(ABILITIES.barkskin.durationMs!)], ["Damage taken", pct(BARKSKIN.taken)], ["Heal", `${BARKSKIN.hps} per second`]],
  flurry: [["Distance", `${Math.round(FLURRY.speed * FLURRY.time)} m`], ["Damage", `${FLURRY.damage}`]],
  innerpeace: [["Heal", `${INNER_PEACE_HEAL}`], ["Effect", "Removes slows"]],
  windstep: [["Lasts", s(ABILITIES.windstep.durationMs!)], ["Speed", `x${WINDSTEP_SPEED}`]],
  palm: [["Damage", `${PALM.damage}`], ["Range", `${PALM.range} m cone`], ["Effect", "A shove"]],
  evasion: [["Lasts", s(ABILITIES.evasion.durationMs!)], ["Effect", "Untouchable"]],
  meteor: [["Damage", `${METEOR.damage} within ${METEOR.radius} m`], ["Range", `${METEOR.range} m`], ["Delay", s(METEOR.delayMs)], ["Effect", "Throws everyone there"]],
  frostnova: [["Radius", `${FROSTNOVA.radius} m`], ["Damage", `${FROSTNOVA.damage}`], ["Effect", `Frozen solid for ${s(ABILITIES.frostnova.durationMs!)}`]],
  blackhole: [["Radius", `${BLACKHOLE.radius} m`], ["Damage", `${BLACKHOLE.dps} per second`], ["Range", `${BLACKHOLE.range} m`], ["Lasts", s(ABILITIES.blackhole.durationMs!)], ["Effect", "Drags everyone into its middle"]],
  whirlwind: [["Damage", `${WHIRLWIND.damage}`], ["Radius", `${WHIRLWIND.radius} m`], ["Effect", "Throws them back"]],
  warcry: [["Radius", `${WARCRY.radius} m`], ["You and teammates", `Take ${pct(1 - WARCRY.taken)} less damage, ${s(ABILITIES.warcry.durationMs!)}`], ["Enemies", `${WARCRY.damage} damage, slowed ${s(WARCRY.slowMs)}`]],
  earthshatter: [["Damage", `${EARTHSHATTER.damage}`], ["Radius", `${EARTHSHATTER.radius} m`], ["Effect", `Launched, slowed ${s(EARTHSHATTER.slowMs)}`]],
  knives: [["Knives", `${KNIVES.count}, all around`], ["Damage", `${SPELLS.knife.damage} each`]],
  assassinate: [["Range", `${ASSASSINATE.range} m`], ["Damage", `${ASSASSINATE.damage}`], ["Effect", "Appear behind them"]],
  phantom: [["Targets", `Up to ${PHANTOM.targets} within ${PHANTOM.range} m`], ["Damage", `${PHANTOM.damage} each`], ["Effect", "Untouchable for 1 s after"]],
  holynova: [["Heal", `${HOLYNOVA.heal} (you and teammates)`], ["Damage", `${HOLYNOVA.damage} (enemies)`], ["Radius", `${HOLYNOVA.radius} m`]],
  guardian: [["Shield", `${GUARDIAN.shield}`], ["Radius", `${GUARDIAN.radius} m (you and teammates)`]],
  wrath: [["Targets", `Up to ${WRATH.targets} within ${WRATH.range} m`], ["Damage", `${SMITE.damage} each`], ["Heal", `${WRATH.heal} (you and teammates)`]],
  thornstorm: [["Thorns", `${THORNSTORM.count}, all around`], ["Damage", `${SPELLS.thorn.damage} each, and a slow`]],
  wildhunt: [["Allies", `${WILDHUNT.wolves} shadow wolves`], ["Lasts", s(ABILITIES.wildhunt.durationMs!)]],
  dragonform: [["Lasts", s(ABILITIES.dragonform.durationMs!)], ["Attack", `Fire, ${SPELLS.flame.damage} a blast`], ["Shield", `${DRAGON.shield}`], ["Damage taken", pct(DRAGON.taken)], ["Effect", "Fly: Space to climb, C to dive"]],
  hundredfists: [["Damage", `${HUNDREDFISTS.damage}`], ["Range", `${HUNDREDFISTS.range} m cone`]],
  cyclone: [["Damage", `${CYCLONE.damage}`], ["Radius", `${CYCLONE.radius} m`], ["Effect", "Sends them flying"]],
  ascend: [["Lasts", s(ABILITIES.ascend.durationMs!)], ["Speed", `x${ASCEND.speed}`], ["Melee", `x${ASCEND.damage} damage`], ["Damage taken", pct(ASCEND.taken)], ["Effect", "Can't be slowed or shoved"]],
};

export function abilityInfo(id: AbilityId): Info {
  const level = abilityLevel(id);
  return {
    title: ABILITIES[id].name,
    lines: [["Cooldown", s(ABILITIES[id].cooldownMs)], ...ROWS[id], ...(level > 1 ? ([["Unlocks", `Level ${level}`]] as [string, string][]) : [])],
    text: ABILITIES[id].description,
  };
}

export function weaponInfo(id: WeaponId, spellName?: string): Info {
  const w = WEAPONS[id];
  if (w.kind === "spell") return { title: spellName ?? "Spell", lines: [], text: "Your Spellbook spell (choose it in the Academy)." };
  if (w.kind === "projectile") {
    const p = SPELLS[w.projectile ?? "arrow"];
    return {
      title: w.name,
      lines: [["Damage", `${p.damage}`], ["Every", s(p.cooldownMs)], ["Range", `${p.range} m`], ...(p.gravity ? ([["Note", "Drops over distance"]] as [string, string][]) : [])],
      text: "Ranged.",
    };
  }
  const m = w.melee!;
  const lines: [string, string][] = [["Damage", `${m.damage}`], ["Every", s(m.cooldownMs)], ["Reach", `${m.reach} m`]];
  if (m.cleave) lines.push(["Hits", "Everyone in front"]);
  if (m.backstab) lines.push(["Backstab", `x${m.backstab}`]);
  if (w.block) lines.push(["Blocks", `${pct(w.block)} ${(w.blockArcDeg ?? 0) >= 360 ? "from every side" : "from the front"}`]);
  if (w.kind === "shield" && !w.moveSpeed) lines.push(["Speed", "No slowdown"]);
  const text = id === "guard" ? "Hold up your guard; click to jab." : w.kind === "shield" ? "Hold to block; click to bash." : "Melee.";
  return { title: w.name, lines, text };
}
