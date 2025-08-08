import { Project, SyntaxKind, Node, ObjectLiteralExpression } from "ts-morph";
import fs from "fs";
import path from "path";

// --- CONFIG: point this at your fetched PS abilities.ts ---
const INPUTS = [
  path.resolve("D:/RandomStuff/PokeLine/data/ps_raw/github/data/abilities.ts"),
  // If you later fetch a Gen9 override file, add it here:
  // path.resolve("D:/RandomStuff/PokeLine/data/ps_raw/github/data/mods/gen9/abilities.ts"),
];

type IR = Record<string, any>;
const outPath = path.resolve("D:/RandomStuff/PokeLine/data/ps_raw/abilities_hooks.gen9.json");

function log(...args: any[]) { console.log(...args); }

log("[INFO] Starting ability hook extraction");
log("[INFO] Inputs:");
for (const p of INPUTS) log("   ", p, fs.existsSync(p) ? "(found)" : "(MISSING)");

// Build project
const project = new Project({ skipAddingFilesFromTsConfig: true });
for (const p of INPUTS) if (fs.existsSync(p)) project.addSourceFileAtPath(p);

// ---------- helpers ----------
function chainModifyMultiplierFrom(text: string): number | null {
  // this.chainModify(0.75)
  const numLit = text.match(/chainModify\(\s*([0-9]*\.?[0-9]+)\s*\)/);
  if (numLit) return parseFloat(numLit[1]);

  // this.chainModify([3, 4])
  const frac = text.match(/chainModify\(\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]\s*\)/);
  if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10);

  // this.chainModify([135, 100])  // PS also uses % style
  const pct = text.match(/chainModify\(\s*\[\s*(\d{2,3})\s*,\s*(100)\s*\]\s*\)/);
  if (pct) return parseInt(pct[1], 10) / 100;

  return null;
}

function addHook(hooks: any, key: string, value: any) {
  if (!value) return;
  if (!hooks[key]) hooks[key] = [];
  hooks[key].push(value);
}

// ---------- detectors ----------
function detectOnModifySTAB(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onModifySTAB");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  log("      [HOOK] onModifySTAB found");
  if (!body) { addHook(hooks, "onModifySTAB", { note: "present_no_body" }); return; }
  const text = body.getText();

  // Adaptability pattern
  const isAdapt =
    /stab\s*===\s*2[^]*return\s*2\.25[^]*return\s*2/.test(text) ||
    /chainModify\(\s*\[\s*9\s*,\s*4\s*\]\s*\)/.test(text) ||
    /return\s*2(\.0)?\s*;/.test(text);

  if (isAdapt) {
    addHook(hooks, "onModifySTAB", { when: "hasSTAB", value: 2.0, upgradeFrom: 1.5, teraValue: 2.25 });
  } else {
    addHook(hooks, "onModifySTAB", { note: "custom_unparsed" });
  }
}

function detectSetWeather(obj: ObjectLiteralExpression, hooks: any) {
  const calls = obj.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(c => c.getExpression().getText().endsWith("setWeather"));
  if (!calls.length) return;
  const arg = calls[0].getArguments()[0];
  if (!arg || !Node.isStringLiteral(arg)) return;
  const weather = arg.getLiteralText();
  log(`      [HOOK] onSwitchIn sets weather: ${weather}`);
  addHook(hooks, "onSwitchIn", { action: "setWeather", weather, durationTurns: 5, itemExtend: "icyrock" });
}

function detectSetTerrain(obj: ObjectLiteralExpression, hooks: any) {
  const calls = obj.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(c => c.getExpression().getText().endsWith("setTerrain"));
  if (!calls.length) return;
  const arg = calls[0].getArguments()[0];
  if (!arg || !Node.isStringLiteral(arg)) return;
  const terrain = arg.getLiteralText();
  log(`      [HOOK] onSwitchIn sets terrain: ${terrain}`);
  addHook(hooks, "onSwitchIn", { action: "setTerrain", terrain, durationTurns: 5, itemExtend: "terrainextender" });
}

function detectOnModifyDamage_SE(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onModifyDamage");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText();
  // Look for super-effective gate and chainModify
  const looksSE = /super|typeMod\s*[>]=?\s*1|isSuperEffective/i.test(text);
  const mult = chainModifyMultiplierFrom(text);
  if (looksSE && mult && mult < 1) {
    log(`      [HOOK] onModifyDamage super-effective x${mult}`);
    addHook(hooks, "onModifyDamage", { when: "hit.isSuperEffective", multiply: mult });
  }
}

function detectOnModifyPriority(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onModifyPriority");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText();

  // Detect "return priority + N"
  const m = text.match(/return\s+priority\s*\+\s*(\-?\d+)/);
  if (m) {
    const delta = parseInt(m[1], 10);
    log(`      [HOOK] onModifyPriority delta ${delta}`);
    // Heuristics: triage often checks healing; prankster checks Status.
    const heals = /move\.(?:flags\.)?heal|healing|drain/.test(text);
    const statusOnly = /move\.category\s*===\s*['"`]Status['"`]/.test(text);
    addHook(hooks, "onModifyPriority", { delta, when: heals ? "healingMoves" : (statusOnly ? "statusMoves" : "always") });
  }
}

function detectStatChainModify(obj: ObjectLiteralExpression, hooks: any) {
  // onModifyAtk / onModifySpA with chainModify -> record multiplier
  const keys = ["onModifyAtk", "onModifySpA"];
  for (const k of keys) {
    const prop = obj.getProperty(k);
    if (!prop) continue;
    const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
    if (!body) continue;
    const mult = chainModifyMultiplierFrom(body.getText());
    if (mult && mult !== 1) {
      log(`      [HOOK] ${k} x${mult}`);
      addHook(hooks, k, { multiply: mult, when: "conditional_or_always" });
    }
  }
}

// quick name-based immunities/absorbs (fast coverage now; refine later)
const NAME_IMMUNITY_MAP: Record<string, any> = {
  "levitate": { immunities: ["ground"] },
  "voltabsorb": { absorb: ["electric"] },
  "waterabsorb": { absorb: ["water"] },
  "stormdrain": { redirect: ["water"], boosts: { spa: 1 } },
  "lightningrod": { redirect: ["electric"], boosts: { spa: 1 } },
  "sapsipper": { absorb: ["grass"], boosts: { atk: 1 } },
  "flamebody": null, // not immunity; left as example to avoid overreach
  "flashfire": { absorb: ["fire"], boosts: { power: { type: "fire", multiply: 1.5 } } },
  "eartheater": { absorb: ["ground"] },
  "goodasgold": { block: ["statusMoves"] },
  "bulletproof": { blockTags: ["ballistic"] },
};

function applyNameBasedHeuristics(name: string, hooks: any) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const entry = NAME_IMMUNITY_MAP[key];
  if (!entry) return;
  addHook(hooks, "meta", { heuristic: entry });
}

function detectBlockStatusMoves(obj: ObjectLiteralExpression, hooks: any) {
  // Looks for: onTryHit / onTryMove bodies that check move.category === 'Status' and return false (block)
  const keys = ["onTryHit", "onTryMove", "onAllyTryHit"]; // PS sometimes varies the hook name
  for (const k of keys) {
    const prop = obj.getProperty(k);
    if (!prop) continue;
    const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
    if (!body) continue;
    const text = body.getText();
    // Heuristic: block if explicitly checks for Status and returns false/null
    const checksStatus = /move\.category\s*===\s*['"`]Status['"`]/.test(text);
    const returnsBlock = /\breturn\s+(?:false|null|undefined)\s*;/.test(text) || /this\.attrLastMove/.test(text);
    if (checksStatus && returnsBlock) {
      addHook(hooks, "blockMove", { when: "statusMoves" });
      return;
    }
  }
}

function detectBlockBallistic(obj: ObjectLiteralExpression, hooks: any) {
  // Bulletproof typically checks move.flags['bullet'] or 'ballistic' and blocks
  const keys = ["onTryHit", "onAllyTryHit", "onDamage"];
  for (const k of keys) {
    const prop = obj.getProperty(k);
    if (!prop) continue;
    const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
    if (!body) continue;
    const text = body.getText();
    const mentionsBallistic = /move\.flags\.(?:bullet|ballistic)/.test(text);
    const returnsBlock = /\breturn\s+(?:false|null|undefined)\s*;/.test(text);
    if (mentionsBallistic && returnsBlock) {
      addHook(hooks, "blockTags", { tags: ["ballistic"] });
      return;
    }
  }
}

function detectRedirectAndBoost(obj: ObjectLiteralExpression, hooks: any) {
  // Look for onAnyRedirectTarget/onFoeRedirectTarget that check move.type and redirect,
  // and a boost to SpA (+1) as part of the effect.
  const keys = ["onAnyRedirectTarget", "onFoeRedirectTarget", "onAllyRedirectTarget"];
  for (const k of keys) {
    const prop = obj.getProperty(k);
    if (!prop) continue;
    const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
    if (!body) continue;
    const text = body.getText();

    const matchType = text.match(/move\.type\s*===\s*['"`](Electric|Water)['"`]/);
    if (!matchType) continue;

    const elem = matchType[1].toLowerCase(); // "electric" or "water"
    const boostsSpa = /this\.boost\(\s*\{\s*spa\s*:\s*1\s*\}/.test(text) || /boost\(\s*\{\s*spa\s*:\s*1\s*\}/.test(text);

    // Also ensure it actually returns a target (redirect), common pattern: "return target;"
    const returnsTarget = /\breturn\s+[a-zA-Z_]\w*\s*;/.test(text);

    if (returnsTarget) {
      addHook(hooks, "redirect", { type: elem });
      if (boostsSpa) addHook(hooks, "onRedirect", { boosts: { spa: 1 } });
      return;
    }
  }
}

function detectAbsorbHeal(obj: ObjectLiteralExpression, hooks: any) {
  // Looks for type check + this.heal(...) → absorb mechanics
  const keys = ["onTryHit", "onDamagingHit", "onSourceHit", "onDamage"];
  for (const k of keys) {
    const prop = obj.getProperty(k);
    if (!prop) continue;
    const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
    if (!body) continue;
    const text = body.getText();

    // Capture move.type === 'X'
    const m = text.match(/move\.type\s*===\s*['"`](Electric|Water|Ground|Fire)['"`]/i);
    if (!m) continue;

    // Detect heal; PS uses this.heal(pokemon.maxhp/4) or similar
    const heals = /this\.heal\(/.test(text) || /heal\(/.test(text);

    if (heals) {
      const t = m[1].toLowerCase();
      addHook(hooks, "absorb", { type: t, heal: "fraction", fraction: "1/4" });
      return;
    }
  }
}

function detectOnImmunityType(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onImmunity");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText();
  // Typical pattern: if (type === 'Ground') return false;
  const m = text.match(/type\s*===\s*['"`](Ground|Electric|Water|Fire)['"`]/i);
  const returnsFalse = /\breturn\s+false\s*;/.test(text);
  if (m && returnsFalse) {
    addHook(hooks, "immunity", { types: [m[1].toLowerCase()] });
  }
}

function detectFullHPMitigation(obj: ObjectLiteralExpression, hooks: any) {
  const keys = ["onSourceModifyDamage", "onModifyDamage"];
  for (const k of keys) {
    const prop = obj.getProperty(k);
    if (!prop) continue;
    const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
    if (!body) continue;
    const text = body.getText();

    // Allow >= or === on hp vs maxhp, any identifier name
    const fullHpCheck =
      /(\b[A-Za-z_]\w*)\.hp\s*(?:===|>=)\s*\1\.maxhp/.test(text) ||
      /\b(hp)\s*(?:===|>=)\s*[^;]*\bmaxhp\b/.test(text) ||
      /Multiscale weaken/.test(text); // debug string in PS

    const mult = chainModifyMultiplierFrom(text);
    if (fullHpCheck && mult && mult < 1) {
      addHook(hooks, "onModifyDamage", { when: "defenderAtFullHP", multiply: mult });
      return;
    }
  }
}


function detectUnaware(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onAnyModifyBoost");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText();

  // PS pattern sets certain stats to 0:
  // boosts['def']=0; boosts['spd']=0; boosts['evasion']=0; boosts['atk']=0; boosts['spa']=0; boosts['accuracy']=0
  const zeroesDefSide = /(boosts\[['"]def['"]]\s*=\s*0|boosts\[['"]spd['"]]\s*=\s*0|boosts\[['"]evasion['"]]\s*=\s*0)/.test(text);
  const zeroesAtkSide = /(boosts\[['"]atk['"]]\s*=\s*0|boosts\[['"]spa['"]]\s*=\s*0|boosts\[['"]accuracy['"]]\s*=\s*0)/.test(text);

  if (zeroesDefSide || zeroesAtkSide) {
    // If you want to be strict later, we can parse branches with activePokemon/activeTarget.
    // For now, mark both sides true (safe for pruning & damage calc).
    addHook(hooks, "ignoreBoosts", { attacker: !!zeroesDefSide, defender: !!zeroesAtkSide });
  }
}


function detectIntimidateAndReactions(obj: ObjectLiteralExpression, hooks: any) {
  // Intimidate: onStart/onSwitchIn with this.boost({atk:-1}, target, source)
  const start = obj.getProperty("onStart") || obj.getProperty("onSwitchIn");
  if (start) {
    const text = start.getText();
    if (/this\.boost\(\s*\{\s*atk\s*:\s*-1\s*\}/.test(text)) {
      addHook(hooks, "onSwitchIn", { action: "foeBoost", boosts: { atk: -1 }, when: "adjacentFoes" });
    }
  }

  // Anti-drops: onTryBoost that cancels negative boosts from foe
  const tryBoost = obj.getProperty("onTryBoost");
  if (tryBoost) {
    const t = tryBoost.getText();
    const blocksNeg = /for\s*\(\s*const\s+stat\s+in\s+boost\s*\)\s*\{[^}]*if\s*\(\s*boost\[stat\]\s*<\s*0/.test(t) ||
                      /boost\.\w+\s*<\s*0/.test(t);
    const cancel = /\breturn\s+null\b|\breturn\s+false\b/.test(t);
    if (blocksNeg && cancel) {
      addHook(hooks, "blockStatDrops", { from: "opponents" });
    }
  }

  // Reactive +2 (Defiant/Competitive): onAfterEachBoost/ onBoost with +2
  const reactKeys = ["onAfterEachBoost", "onAfterBoost", "onBoost"];
  for (const k of reactKeys) {
    const prop = obj.getProperty(k);
    if (!prop) continue;
    const text = prop.getText();
    // Look for this.boost({atk:2}) or spa:2
    if (/this\.boost\(\s*\{\s*atk\s*:\s*2\s*\}/.test(text)) {
      addHook(hooks, "onStatLoweredByFoe", { selfBoosts: { atk: 2 } });
    }
    if (/this\.boost\(\s*\{\s*spa\s*:\s*2\s*\}/.test(text)) {
      addHook(hooks, "onStatLoweredByFoe", { selfBoosts: { spa: 2 } });
    }
  }
}

function detectOnBasePowerTagBoosts(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onBasePower");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText();

  // Strong Jaw: bite
  if (/(move\.flags\.(?:bite))|(move\.flags\[['"]bite['"]\])/.test(text)) {
    const mult = chainModifyMultiplierFrom(text) ?? 1.5;
    addHook(hooks, "onBasePower", { when: "tag:bite", multiply: mult });
  }

  // Iron Fist: punch
  if (/(move\.flags\.(?:punch))|(move\.flags\[['"]punch['"]\])/.test(text)) {
    const mult = chainModifyMultiplierFrom(text) ?? 1.2;
    addHook(hooks, "onBasePower", { when: "tag:punch", multiply: mult });
  }

  // Sharpness: slicing
  if (/(move\.flags\.(?:slicing))|(move\.flags\[['"]slicing['"]\])/.test(text)) {
    const mult = chainModifyMultiplierFrom(text) ?? 1.5;
    addHook(hooks, "onBasePower", { when: "tag:slicing", multiply: mult });
  }

  // Mega Launcher: pulse/aura
  if (/(move\.flags\.(?:pulse|aura))|(move\.flags\[['"](pulse|aura)['"]\])/.test(text)) {
    const mult = chainModifyMultiplierFrom(text) ?? 1.5;
    addHook(hooks, "onBasePower", { when: "tag:pulse", multiply: mult });
  }
}

function detectTechnician(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onBasePower");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText();

  const hasTechCue = /Technician boost/.test(text) || /basePowerAfterMultiplier/.test(text);
  const hasThreshold = /(<=\s*60)/.test(text);

  if (hasTechCue || hasThreshold) {
    const mult = chainModifyMultiplierFrom(text) ?? 1.5;
    addHook(hooks, "onBasePower", { when: "bp<=60", multiply: mult, tag: "technician" });
  }
}


function detectProtoQuark(obj: ObjectLiteralExpression, hooks: any) {
  // Look for "Protosynthesis" or "Quark Drive" behavior patterns:
  // - reading weather/terrain
  // - setting a volatile with speed or highest-stat multiplier
  const bodyText = obj.getText().toLowerCase();
  const mentionsProto = bodyText.includes("protosynthesis");
  const mentionsQuark = bodyText.includes("quark drive") || bodyText.includes("quarkdrive");
  if (!(mentionsProto || mentionsQuark)) return;

  // Rough signals:
  const checksSun = /sunnyday|desolateland|sun/i.test(obj.getText());
  const checksETerrain = /electricterrain/i.test(obj.getText());
  const mentionsBooster = /booster\s*energy/i.test(obj.getText());
  // Speed mult often 1.5; other stats ~1.3
  addHook(hooks, "protoquark", {
    type: mentionsProto ? "protosynthesis" : "quarkdrive",
    triggers: { sun: checksSun, electricTerrain: checksETerrain, boosterEnergy: mentionsBooster },
    effects: { speedMult: 1.5, otherStatMult: 1.3 } // annotate; your engine decides which stat
  });
}

function detectIgnoreAbilityOnMove(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onModifyMove");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText();
  if (/move\.ignoreAbility\s*=\s*true/.test(text)) {
    addHook(hooks, "onModifyMove", { set: { ignoreAbility: true } });
  }
}

function detectTypeRewriteAbilities(obj: ObjectLiteralExpression, hooks: any) {
  const onModType = obj.getProperty("onModifyType");
  const onBP = obj.getProperty("onBasePower");
  if (!onModType || !onBP) return;

  const modText = onModType.getText();
  const match = modText.match(/move\.type\s*=\s*['"`](Fairy|Flying|Ice|Electric|Normal)['"`]/);
  if (!match) return;

  const toType = match[1].toLowerCase();
  const fromType = toType === "normal" ? undefined : "normal"; // Normalize rewrites all, no fromType restriction

  if (fromType) {
    addHook(hooks, "onModifyType", {
      rewriteTypeFrom: fromType,
      rewriteTypeTo: toType,
      stabUpgrade: true
    });
  } else {
    addHook(hooks, "onModifyType", {
      rewriteTypeTo: toType,
      rewriteAll: true
    });
  }

  const bpText = onBP.getText();
  if (/move\.typeChangerBoosted\s*===\s*this\.effect/.test(bpText)) {
    const mult = chainModifyMultiplierFrom(bpText) ?? 1.2;
    addHook(hooks, "onBasePower", {
      when: fromType
        ? `afterTypeRewrite:${fromType}->${toType}`
        : `type:${toType}`,
      multiply: mult,
      tag: "typeRewrite"
    });
  }
}

function detectToughClaws(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onBasePower");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText();
  if (/(move\.flags\.(?:contact))|(move\.flags\[['"]contact['"]\])/.test(text)) {
    const mult = chainModifyMultiplierFrom(text) ?? 1.3;
    addHook(hooks, "onBasePower", { when: "tag:contact", multiply: mult });
  }
}

function detectReckless(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onBasePower");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText();
  if (/move\.(?:recoil|hasCrashDamage|mindBlownRecoil)/.test(text)) {
    const mult = chainModifyMultiplierFrom(text) ?? 1.2;
    addHook(hooks, "onBasePower", { when: "recoilOrCrash", multiply: mult });
  }
}

function detectRockHead(obj: ObjectLiteralExpression, hooks: any) {
  // PS usually cancels damage if effect.id === 'recoil'|'crash'
  const keys = ["onDamage", "onTryMove", "onModifyMove"];
  for (const k of keys) {
    const prop = obj.getProperty(k);
    if (!prop) continue;
    const text = prop.getText();
    if (/effect\.id\s*===\s*['"`](recoil|crash)['"`]/.test(text) || /move\.(recoil|hasCrashDamage)/.test(text)) {
      addHook(hooks, "negateRecoil", { crashToo: true });
      return;
    }
  }
}

function detectSheerForce(obj: ObjectLiteralExpression, hooks: any) {
  const onModMove = obj.getProperty("onModifyMove");
  const onBP = obj.getProperty("onBasePower");
  if (!onModMove || !onBP) return;

  const modText = onModMove.getText();
  // Must actually remove secondaries
  const strips = /delete\s+move\.secondaries/.test(modText) ||
                 /move\.secondaries\s*=\s*\[\]/.test(modText) ||
                 /move\.secondaries\s*=\s*null/.test(modText);
  if (!strips) return;

  addHook(hooks, "onModifyMove", { stripSecondaries: true });

  const bpText = onBP.getText();
  const mult = chainModifyMultiplierFrom(bpText) ?? 1.3;
  addHook(hooks, "onBasePower", { when: "hadSecondariesStrippedOrEligible", multiply: mult, tag: "sheerforce" });
}


function detectWeatherSpeed(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onModifySpe");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText().toLowerCase();

  let weather: string | null = null;
  if (/rain/.test(text)) weather = "rain";
  else if (/sun|desolateland/.test(text)) weather = "sun";
  else if (/sandstorm/.test(text)) weather = "sand";
  else if (/snow|hail/.test(text)) weather = "snow";

  if (weather) {
    const mult = chainModifyMultiplierFrom(text) ?? 2.0;
    addHook(hooks, "onModifySpe", { when: "weather:" + weather, multiply: mult });
  }
}

function detectWeatherPowerBoosts(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onBasePower");
  if (!prop) return;
  const body = prop.getFirstDescendantByKind(SyntaxKind.Block);
  if (!body) return;
  const text = body.getText().toLowerCase();

  // Example: Sand Force checks weather + move.type rock/ground/steel
  const weather = /sandstorm/.test(text) ? "sand"
               : /rain/.test(text) ? "rain"
               : /sun|desolateland/.test(text) ? "sun"
               : /snow|hail/.test(text) ? "snow" : null;
  if (!weather) return;

  const typeMatch = text.match(/move\.type\s*===\s*['"`](rock|ground|steel|water|fire|ice|electric)['"`]/i);
  if (!typeMatch) return;

  const mult = chainModifyMultiplierFrom(text) ?? 1.3;
  addHook(hooks, "onBasePower", { when: `weather:${weather}:type:${typeMatch[1].toLowerCase()}`, multiply: mult });
}

function detectMagicBounce(obj: ObjectLiteralExpression, hooks: any) {
  const keys = ["onTryHit", "onAllyTryHit"];
  for (const k of keys) {
    const prop = obj.getProperty(k);
    if (!prop) continue;
    const text = prop.getText();
    const checksStatus = /move\.category\s*===\s*['"`]Status['"`]/.test(text);
    const mentionsBounce = /bounced|hasBounced|this\.useMove|this\.hitStepMoveHit/.test(text);
    if (checksStatus && mentionsBounce) {
      addHook(hooks, "reflectStatusMoves", { scope: "singleTarget" });
      return;
    }
  }
}

function detectMagicGuard(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onDamage");
  if (!prop) return;
  const text = prop.getText();
  // Typical: if (effect && effect.effectType !== 'Move') return false;
  const blocksResidual = /effect(?:\.\w+)?\.effectType\s*!==\s*['"`]Move['"`]/.test(text) || /return\s+false\s*;/.test(text);
  if (blocksResidual) {
    addHook(hooks, "ignoreResidualDamage", { hazards: true, statusChip: true, weatherChip: true, lifeOrb: true });
  }
}

function detectPoisonHeal(obj: ObjectLiteralExpression, hooks: any) {
  const prop = obj.getProperty("onResidual");
  if (!prop) return;
  const text = prop.getText().toLowerCase();
  if (/status\s*===\s*['"`](psn|tox)['"`]/.test(text) && /this\.heal\(/.test(text)) {
    addHook(hooks, "onResidual", { when: "status:poison", healFraction: "1/8" });
  }
}

function detectBlockSound(obj: ObjectLiteralExpression, hooks: any) {
  const keys = ["onTryHit", "onAllyTryHit", "onDamage"];
  for (const k of keys) {
    const prop = obj.getProperty(k);
    if (!prop) continue;
    const text = prop.getText();
    if (/(move\.flags\.(?:sound))|(move\.flags\[['"]sound['"]\])/.test(text)) {
      const returnsBlock = /\breturn\s+(?:false|null|undefined)\s*;/.test(text);
      if (returnsBlock) {
        addHook(hooks, "blockTags", { tags: ["sound"] });
        return;
      }
    }
  }
}

function detectOvercoat(obj: ObjectLiteralExpression, hooks: any) {
  const text = obj.getText().toLowerCase();
  if (text.includes("powder") || /move\.flags\[['"]powder['"]\]/.test(text)) {
    addHook(hooks, "blockTags", { tags: ["powder"] });
  }
  if (text.includes("sandstorm") || text.includes("hail") || text.includes("snow")) {
    addHook(hooks, "ignoreResidualDamage", { weatherChip: true });
  }
}


// ---------- per-ability ----------
function extractAbility(ir: IR, name: string, obj: ObjectLiteralExpression) {
  const hasOnBasePower = !!obj.getProperty("onBasePower");
  if (hasOnBasePower) {
    const b = obj.getPropertyOrThrow("onBasePower").getFirstDescendantByKind(SyntaxKind.Block);
    console.log(`      [DBG] onBasePower present for ${name} (body=${b ? "yes" : "no"})`);
  }
  const hooks: any = {};
  detectOnModifySTAB(obj, hooks);
  detectSetWeather(obj, hooks);
  detectSetTerrain(obj, hooks);
  detectOnModifyDamage_SE(obj, hooks);
  detectOnModifyPriority(obj, hooks);
  detectStatChainModify(obj, hooks);
  applyNameBasedHeuristics(name, hooks);
  detectBlockStatusMoves(obj, hooks);
  detectBlockBallistic(obj, hooks);
  detectRedirectAndBoost(obj, hooks);
  detectAbsorbHeal(obj, hooks);
  detectOnImmunityType(obj, hooks);
  detectFullHPMitigation(obj, hooks);
  detectUnaware(obj, hooks);
  detectIntimidateAndReactions(obj, hooks);
  detectTechnician(obj, hooks);
  detectOnBasePowerTagBoosts(obj, hooks);
  detectProtoQuark(obj, hooks);
  detectIgnoreAbilityOnMove(obj, hooks);
  detectTypeRewriteAbilities(obj, hooks);
  detectToughClaws(obj, hooks);
  detectReckless(obj, hooks);
  detectRockHead(obj, hooks);
  detectSheerForce(obj, hooks);
  detectWeatherSpeed(obj, hooks);
  detectWeatherPowerBoosts(obj, hooks);
  detectMagicBounce(obj, hooks);
  detectMagicGuard(obj, hooks);
  detectPoisonHeal(obj, hooks);
  detectBlockSound(obj, hooks);
  detectOvercoat(obj, hooks);
  applyNameBasedHeuristics(name, hooks); // optional fallback, last


  if (Object.keys(hooks).length) {
    log(`   [+] Hooks found for ability: ${name}`);
    ir[name] = { id: name, hooks };
  }
}

// ---------- entry ----------
function findAbilitiesObject(sf: any): ObjectLiteralExpression | null {
  const decl = sf.getVariableDeclaration("Abilities");
  if (decl) {
    const init = decl.getInitializer();
    if (init && Node.isObjectLiteralExpression(init)) return init;
  }
  // Fallbacks
  for (const vs of sf.getVariableStatements()) {
    for (const v of vs.getDeclarations()) {
      if (v.getName() === "Abilities") {
        const init = v.getInitializer();
        if (init && Node.isObjectLiteralExpression(init)) return init;
      }
    }
  }
  return null;
}

function run() {
  const out: IR = {};
  const sfs = project.getSourceFiles();
  log(`[INFO] Loaded ${sfs.length} source files`);
  if (!sfs.length) {
    log("[ERROR] No source files loaded. Check INPUTS paths.");
    process.exit(1);
  }

  for (const sf of sfs) {
    log(`[INFO] Processing: ${sf.getFilePath()}`);
    const abilitiesObj = findAbilitiesObject(sf);
    if (!abilitiesObj) {
      log("   [WARN] 'Abilities' object not found in this file.");
      continue;
    }
    const props = abilitiesObj.getProperties();
    log(`   [INFO] Found ${props.length} ability entries`);
    for (const prop of props) {
      if (!Node.isPropertyAssignment(prop)) continue;
      const name = prop.getName().replace(/['"`]/g, "");
      const init = prop.getInitializer();
      if (!init || !Node.isObjectLiteralExpression(init)) continue;
      extractAbility(out, name, init);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  log("[INFO] Extraction complete.");
  log(`[INFO] Wrote ${Object.keys(out).length} abilities with hooks to ${outPath}`);
}

run();
