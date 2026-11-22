// The simulation: one wing at a time. Deterministic — the only randomness is a
// seeded generator, so the same inputs always replay the same heist.
import {
  TILE, FIELD_W, FIELD_H, STEP, PLAYER_R, WALK_SPEED, SNEAK_SPEED, VENT_SPEED,
  ALARM_MAX, ALARM_DECAY, ALARM_RISE_GUARD, ALARM_RISE_CAMERA, ALARM_RISE_LASER,
  BUSTS, GUARD_VIEW, GUARD_VIEW_SNEAK, CAMERA_VIEW, CONE_HALF_ANGLE,
} from './config.js';
import { WINGS, LOOT_VALUE, LOOT_NAME, SHOP_STOCK } from './levels.js';

/** Small seeded generator: mulberry32. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TOOL_KEYS = ['smoke', 'decoy', 'emp', 'cutter', 'soles', 'pick'];

function tileAt(grid, cx, cy) {
  if (cy < 0 || cy >= grid.length || cx < 0 || cx >= grid[0].length) return '#';
  return grid[cy][cx];
}

export function isWall(grid, cx, cy) {
  const t = tileAt(grid, cx, cy);
  return t === '#';
}

/** Grid line-of-sight between two pixel points (DDA over tiles). */
export function hasLineOfSight(grid, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (TILE / 3)));
  for (let i = 1; i < steps; i += 1) {
    const x = x0 + (dx * i) / steps, y = y0 + (dy * i) / steps;
    if (isWall(grid, Math.floor(x / TILE), Math.floor(y / TILE))) return false;
  }
  return true;
}

function inCone(ox, oy, facing, range, px, py, halfAngle) {
  const dx = px - ox, dy = py - oy;
  const d = Math.hypot(dx, dy);
  if (d > range || d < 1) return d < 1;
  let a = Math.atan2(dy, dx) - facing;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return Math.abs(a) <= halfAngle;
}

/** Breadth-first path over walkable tiles; null when no route exists. */
export function findPathGrid(grid, sx, sy, tx, ty) {
  const key = (x, y) => `${x},${y}`;
  const prev = new Map();
  const queue = [[sx, sy]];
  prev.set(key(sx, sy), null);
  const walk = (x, y) => y >= 0 && y < grid.length && x >= 0 && x < grid[0].length && grid[y][x] !== '#';
  while (queue.length) {
    const [cx, cy] = queue.shift();
    if (cx === tx && cy === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!walk(nx, ny) || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), [cx, cy]);
      queue.push([nx, ny]);
    }
  }
  if (!prev.has(key(tx, ty))) return null;
  const path = [];
  let cur = [tx, ty];
  while (cur) { path.unshift(cur); cur = prev.get(key(cur[0], cur[1])); }
  return path;
}

export class WingWorld {
  constructor(wingIndex, carry) {
    this.wingIndex = wingIndex;
    this.wing = WINGS[wingIndex];
    this.grid = this.wing.map.map((row) => row.split(''));
    this.time = 0;
    this.rng = makeRng(1000 + wingIndex * 77);
    this.alarm = 0;
    this.lockdown = false;
    this.bustsLeft = carry.bustsLeft;
    this.coins = carry.coins;
    this.wingLoot = 0;
    this.tools = { ...carry.tools };
    this.solesActive = this.tools.soles > 0;
    this.score = carry.score;
    this.targetsTaken = carry.targetsTaken;
    this.caughtFlash = 0;
    this.message = '';
    this.messageT = 0;
    this.smokeT = 0;
    this.empT = 0;
    this.channel = null; // {kind, x, y, t, need}
    this.ventCooldown = 0;
    this.loot = [];
    this.guards = [];
    this.cameras = [];
    this.lasers = [];
    this.vents = [];
    this.decoys = [];
    this.start = { x: 60, y: 60 };
    this.exit = { x: 60, y: 60 };
    this.target = null;
    this.player = { x: 60, y: 60, facing: 0, sneaking: false, running: false, hidden: false, inVent: false };
    this.events = [];
    this.parseMap();
  }

  parseMap() {
    const w = this.wing;
    for (let y = 0; y < this.grid.length; y += 1) {
      for (let x = 0; x < this.grid[y].length; x += 1) {
        const t = this.grid[y][x];
        const px = x * TILE + TILE / 2, py = y * TILE + TILE / 2;
        if (t === 'S') this.start = { x: px, y: py };
        if (t === 'D') this.exit = { x: px, y: py };
        if (t === 'T') this.target = { x: px, y: py, taken: false };
        if (t === 'V') this.vents.push({ x: px, y: py });
        if (LOOT_VALUE[t]) this.loot.push({ kind: t, x: px, y: py, taken: false, name: LOOT_NAME[t] });
      }
    }
    this.player.x = this.start.x;
    this.player.y = this.start.y;
    for (const g of w.guards) {
      const path = g.path.map(([tx, ty]) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }));
      this.guards.push({
        kind: g.kind, path, wp: 0, x: path[0].x, y: path[0].y,
        facing: 0, speed: g.speed * 55, suspicion: 0, state: 'patrol',
        lastSeen: null, loseT: 0, stunT: 0, scanT: this.rng() * 6,
        pathTiles: null, pathIdx: 0, repathT: 0,
      });
    }
    for (const c of w.cameras) {
      this.cameras.push({
        x: c.tx * TILE + TILE / 2, y: c.ty * TILE + TILE / 2,
        base: c.base, sweep: c.sweep, speed: c.speed, phase: this.rng() * 6, disabledT: 0,
      });
    }
    for (const l of w.lasers) {
      this.lasers.push({
        x1: l.x1 * TILE, y1: l.y1 * TILE + TILE / 2, x2: l.x2 * TILE, y2: l.y2 * TILE + TILE / 2,
        period: l.period, duty: l.duty, phase: this.rng() * l.period, disabledT: 0,
      });
    }
  }

  say(text) { this.message = text; this.messageT = 3.5; }

  wallAtPx(x, y) { return isWall(this.grid, Math.floor(x / TILE), Math.floor(y / TILE)); }

  moveCircle(e, dx, dy) {
    const nx = e.x + dx;
    if (!this.wallAtPx(nx + Math.sign(dx) * PLAYER_R, e.y - PLAYER_R + 2) &&
        !this.wallAtPx(nx + Math.sign(dx) * PLAYER_R, e.y + PLAYER_R - 2)) e.x = nx;
    const ny = e.y + dy;
    if (!this.wallAtPx(e.x - PLAYER_R + 2, ny + Math.sign(dy) * PLAYER_R) &&
        !this.wallAtPx(e.x + PLAYER_R - 2, ny + Math.sign(dy) * PLAYER_R)) e.y = ny;
  }

  laserOn(laser) {
    if (laser.disabledT > 0) return false;
    const cyc = (this.time + laser.phase) % laser.period;
    return cyc < laser.period * laser.duty;
  }

  playerSeenBy(guard) {
    if (this.smokeT > 0 || this.player.hidden || this.player.inVent) return false;
    // Elites see far — but sneaking still shrinks even an elite's cone, so
    // there is always a counter to every watcher.
    const base = this.player.sneaking ? GUARD_VIEW_SNEAK : GUARD_VIEW;
    const range = guard.kind === 'elite' ? base * 1.35
      : guard.kind === 'dog' ? GUARD_VIEW * 0.7
      : base;
    return inCone(guard.x, guard.y, guard.facing, range, this.player.x, this.player.y, CONE_HALF_ANGLE)
      && hasLineOfSight(this.grid, guard.x, guard.y, this.player.x, this.player.y);
  }

  playerSeenByCamera(cam) {
    if (this.empT > 0 || cam.disabledT > 0 || this.smokeT > 0 || this.player.hidden || this.player.inVent) return false;
    const facing = cam.base + Math.sin((this.time + cam.phase) * cam.speed) * cam.sweep;
    cam.facing = facing;
    return inCone(cam.x, cam.y, facing, CAMERA_VIEW, this.player.x, this.player.y, CONE_HALF_ANGLE)
      && hasLineOfSight(this.grid, cam.x, cam.y, this.player.x, this.player.y);
  }

  playerOnLaser() {
    for (const l of this.lasers) {
      if (!this.laserOn(l)) continue;
      const vertical = l.x1 === l.x2;
      if (vertical) {
        if (Math.abs(this.player.x - l.x1) < 12 && this.player.y > Math.min(l.y1, l.y2) && this.player.y < Math.max(l.y1, l.y2)) return true;
      } else if (Math.abs(this.player.y - l.y1) < 12 && this.player.x > Math.min(l.x1, l.x2) && this.player.x < Math.max(l.x1, l.x2)) return true;
    }
    return false;
  }

  nearestLoot(maxD) {
    let best = null, bd = maxD;
    for (const item of this.loot) {
      if (item.taken) continue;
      const d = Math.hypot(item.x - this.player.x, item.y - this.player.y);
      if (d < bd) { bd = d; best = item; }
    }
    return best;
  }

  grabTime(item) {
    if (this.tools.cutter > 0) return 0;
    return item.kind === 'p' || item.kind === 'g' ? 1.2 : 0;
  }

  takeLoot(item) {
    item.taken = true;
    const v = LOOT_VALUE[item.kind];
    this.coins += v; this.wingLoot += v; this.score += v;
    this.say(`+${v} — ${item.name}`);
    this.events.push({ type: 'loot', value: v });
  }

  takeTarget() {
    this.target.taken = true;
    this.coins += this.wing.targetValue; this.wingLoot += this.wing.targetValue;
    this.score += this.wing.targetValue;
    this.targetsTaken += 1;
    // The getaway beat: the vault's flash dazzles every watcher for a moment
    // and the alarm dips — the planning pays off, now run.
    for (const g of this.guards) { g.stunT = 1.5; g.suspicion = 0; g.state = 'patrol'; g.lastSeen = null; g.pathTiles = null; }
    this.alarm = Math.max(0, this.alarm - 20);
    this.say(`TARGET TAKEN — ${this.wing.targetName}! Reach the exit.`);
    this.events.push({ type: 'target', value: this.wing.targetValue });
  }

  useTool(id, mx, my) {
    if (id === 'cutter' || id === 'soles' || id === 'pick') { this.say(`${id} is passive — it works on its own.`); return; }
    if ((this.tools[id] ?? 0) <= 0) { this.say(`No ${id} left — buy more at the Fence.`); return; }
    this.tools[id] -= 1;
    if (id === 'smoke') { this.smokeT = 4; this.say('Smoke pellet — every eye is blind for 4s.'); }
    if (id === 'emp') {
      this.empT = 6;
      for (const l of this.lasers) l.disabledT = 6;
      for (const c of this.cameras) c.disabledT = 6;
      this.say('EMP burst — cameras and lasers dark for 6s.');
    }
    if (id === 'decoy') {
      const tx = mx ?? this.player.x + 160, ty = my ?? this.player.y;
      this.decoys.push({ x: tx, y: ty, t: 3 });
      for (const g of this.guards) {
        if (g.state !== 'chase') { g.state = 'investigate'; g.lastSeen = { x: tx, y: ty }; g.suspicion = 0.4; }
      }
      this.say('Decoy chime — the guards walk to the sound.');
    }
    this.events.push({ type: 'tool', id });
  }

  enterVent() {
    if (this.ventCooldown > 0) return false;
    const near = this.vents.find((v) => Math.hypot(v.x - this.player.x, v.y - this.player.y) < 34);
    if (!near) return false;
    const other = this.vents.find((v) => v !== near);
    if (!other) return false;
    this.player.x = other.x; this.player.y = other.y;
    this.player.inVent = true;
    this.ventCooldown = 1.5;
    this.say('Vent crawl — no eye watches the ducts.');
    this.events.push({ type: 'vent' });
    return true;
  }

  bust() {
    const lost = Math.floor(this.wingLoot / 4);
    this.coins -= lost; this.score -= lost; this.wingLoot -= lost;
    this.bustsLeft -= 1;
    this.alarm = 40; this.lockdown = false;
    this.player.x = this.start.x; this.player.y = this.start.y;
    this.channel = null;
    for (const g of this.guards) { g.state = 'patrol'; g.suspicion = 0; g.lastSeen = null; g.wp = 0; g.x = g.path[0].x; g.y = g.path[0].y; }
    this.caughtFlash = 1.2;
    this.say(`CAUGHT! The Fence's cut: -${lost} coins. ${this.bustsLeft} bust${this.bustsLeft === 1 ? '' : 's'} left.`);
    this.events.push({ type: 'bust', lost });
    return this.bustsLeft <= 0 ? 'gameover' : 'busted';
  }

  step(dt, input) {
    this.time += dt;
    if (this.messageT > 0) this.messageT -= dt;
    if (this.caughtFlash > 0) this.caughtFlash -= dt;
    if (this.smokeT > 0) this.smokeT -= dt;
    if (this.empT > 0) this.empT -= dt;
    if (this.ventCooldown > 0) this.ventCooldown -= dt;
    for (const c of this.cameras) if (c.disabledT > 0) c.disabledT -= dt;
    for (const l of this.lasers) if (l.disabledT > 0) l.disabledT -= dt;
    for (const d of this.decoys) d.t -= dt;
    this.decoys = this.decoys.filter((d) => d.t > 0);

    const p = this.player;
    p.sneaking = !!input.sneak;
    p.running = !p.sneaking && !!input.run;
    const speed = p.inVent ? VENT_SPEED : p.sneaking ? SNEAK_SPEED : WALK_SPEED;
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (mx || my) {
      const n = Math.hypot(mx, my); mx /= n; my /= n;
      p.facing = Math.atan2(my, mx);
      this.moveCircle(p, mx * speed * dt, my * speed * dt);
      if (p.inVent && !this.vents.some((v) => Math.hypot(v.x - p.x, v.y - p.y) < 40)) p.inVent = false;
    }
    // Hiding in plants: standing still inside a plant tile hides the thief.
    const tile = this.grid[Math.floor(p.y / TILE)]?.[Math.floor(p.x / TILE)];
    p.hidden = tile === 'H' && !mx && !my;

    // Interaction / channel: loot, target, vent, exit.
    if (input.interact) {
      const vent = this.vents.find((v) => Math.hypot(v.x - p.x, v.y - p.y) < 34);
      if (vent && !this.channel) { this.enterVent(); }
      else if (this.target && !this.target.taken && Math.hypot(this.target.x - p.x, this.target.y - p.y) < 40) {
        this.channel = this.channel ?? { kind: 'target', t: 0, need: this.tools.cutter > 0 ? 0.4 : 1.2 };
      } else {
        const item = this.nearestLoot(38);
        if (item) {
          const need = this.grabTime(item);
          if (need === 0) this.takeLoot(item);
          else this.channel = this.channel ?? { kind: 'loot', item, t: 0, need };
        }
      }
    } else if (this.channel && this.channel.kind !== 'vent') {
      this.channel = null;
    }
    if (this.channel) {
      // Walking away breaks the channel — a grab must be earned standing still.
      const anchor = this.channel.kind === 'target' ? this.target : this.channel.item;
      if (!anchor || Math.hypot(anchor.x - p.x, anchor.y - p.y) > 60) this.channel = null;
    }
    if (this.channel) {
      this.channel.t += dt;
      if (this.channel.t >= this.channel.need) {
        if (this.channel.kind === 'target') this.takeTarget();
        else if (this.channel.item) this.takeLoot(this.channel.item);
        this.channel = null;
      }
    }

    // Exit: only once the target is taken; locked during lockdown without a pick.
    if (this.target && this.target.taken && Math.hypot(this.exit.x - p.x, this.exit.y - p.y) < 30) {
      if (this.lockdown && this.tools.pick <= 0) {
        this.say('LOCKDOWN — the exit is sealed. A lock pick would open it.');
      } else {
        if (this.lockdown && this.tools.pick > 0) { this.tools.pick -= 1; this.say('Lock pick — the sealed exit opens.'); }
        return 'wingclear';
      }
    }

    // Detection.
    let seen = false; let seenByGuard = false;
    for (const g of this.guards) {
      if (g.stunT > 0) { g.stunT -= dt; continue; }
      const sees = this.playerSeenBy(g);
      if (sees) {
        seen = true; seenByGuard = true;
        g.suspicion = Math.min(1, g.suspicion + dt * 1.6);
        g.lastSeen = { x: p.x, y: p.y };
        if (g.suspicion >= 1 && g.state !== 'chase') { g.state = 'chase'; g.loseT = 0; }
      } else if (g.suspicion > 0) {
        g.suspicion = Math.max(0, g.suspicion - dt * 0.35);
      }
      this.updateGuard(g, dt, p);
      if (Math.hypot(g.x - p.x, g.y - p.y) < 26 && !p.hidden && !p.inVent) {
        return this.bust();
      }
    }
    for (const cam of this.cameras) {
      if (this.playerSeenByCamera(cam)) seen = true;
    }
    if (this.playerOnLaser()) { seen = true; this.alarm += ALARM_RISE_LASER * dt; }
    if (seen) {
      this.alarm += (seenByGuard ? ALARM_RISE_GUARD : ALARM_RISE_CAMERA) * dt;
    } else {
      this.alarm = Math.max(0, this.alarm - ALARM_DECAY * dt);
    }
    this.alarm = Math.min(ALARM_MAX, this.alarm);
    // Lockdown lifts once the museum calms down again.
    if (this.lockdown && this.alarm < 30) {
      this.lockdown = false;
      this.say('Lockdown lifted — the guards stand down.');
    }
    // The hound hears running.
    if (p.running && !this.solesActive) {
      for (const g of this.guards) {
        if (g.kind === 'dog' && Math.hypot(g.x - p.x, g.y - p.y) < 280) {
          g.state = 'investigate'; g.lastSeen = { x: p.x, y: p.y };
        }
      }
    }
    if (this.alarm >= ALARM_MAX && !this.lockdown) {
      this.lockdown = true;
      this.alarm = ALARM_MAX;
      this.say('LOCKDOWN! Doors sealed, every guard is hunting.');
      for (const g of this.guards) { if (g.state === 'patrol') { g.state = 'investigate'; g.lastSeen = { x: p.x, y: p.y }; } }
      this.events.push({ type: 'lockdown' });
    }
    return 'playing';
  }

  updateGuard(g, dt, p) {
    // Chase speed is capped below the thief's walk speed: a chase must be
    // escapable by running, never a guaranteed catch.
    const speed = g.state === 'chase' ? Math.min(g.speed * 1.5, 150) : g.speed;
    const moveToward = (tx, ty, sp) => {
      const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy);
      if (d < 4) return true;
      g.facing = Math.atan2(dy, dx);
      this.moveCircle(g, (dx / d) * sp * dt, (dy / d) * sp * dt);
      return false;
    };
    // Chasing and investigating guards path around walls instead of walking
    // straight into them: repath to the last seen tile twice a second.
    const followPath = (sp) => {
      if (!g.lastSeen) return true;
      g.repathT -= dt;
      const tx = Math.floor(g.lastSeen.x / TILE), ty = Math.floor(g.lastSeen.y / TILE);
      if (!g.pathTiles || g.repathT <= 0) {
        g.pathTiles = findPathGrid(this.grid, Math.floor(g.x / TILE), Math.floor(g.y / TILE), tx, ty);
        g.pathIdx = 0;
        g.repathT = 0.6;
      }
      if (!g.pathTiles || g.pathTiles.length < 2) return moveToward(g.lastSeen.x, g.lastSeen.y, sp);
      while (g.pathIdx < g.pathTiles.length - 1) {
        const [wx, wy] = g.pathTiles[g.pathIdx];
        if (Math.hypot(wx * TILE + TILE / 2 - g.x, wy * TILE + TILE / 2 - g.y) < 10) g.pathIdx += 1;
        else break;
      }
      const [wx, wy] = g.pathTiles[Math.min(g.pathIdx + 1, g.pathTiles.length - 1)];
      return moveToward(wx * TILE + TILE / 2, wy * TILE + TILE / 2, sp);
    };
    if (g.state === 'patrol') {
      if (g.path.length <= 1) {
        // Stationary watcher: slowly sweep the room.
        g.scanT += dt;
        g.facing = Math.sin(g.scanT * 0.5) * 1.4 + Math.PI / 2;
        return;
      }
      const target = g.path[g.wp];
      if (moveToward(target.x, target.y, speed)) g.wp = (g.wp + 1) % g.path.length;
    } else if (g.state === 'chase') {
      if (this.playerSeenBy(g)) { g.loseT = 0; g.lastSeen = { x: p.x, y: p.y }; }
      else { g.loseT += dt; if (g.loseT > 3) { g.state = 'investigate'; } }
      if (g.lastSeen) followPath(speed);
    } else if (g.state === 'investigate') {
      if (g.lastSeen && followPath(speed)) {
        g.state = 'patrol';
        g.lastSeen = null;
        g.pathTiles = null;
      }
      if (g.kind === 'runner' && this.alarm > 50 && this.playerSeenBy(g)) { g.state = 'chase'; g.suspicion = 1; }
    }
  }
}

// The Fence: spend wing coins on tools between wings. Returns the new carry.
export function buyTool(carry, id) {
  const item = SHOP_STOCK.find((s) => s.id === id);
  if (!item || carry.coins < item.price) return false;
  carry.coins -= item.price;
  carry.tools[id] = (carry.tools[id] ?? 0) + 1;
  return true;
}

export function freshCarry() {
  return {
    bustsLeft: BUSTS,
    coins: 0,
    score: 0,
    targetsTaken: 0,
    tools: { smoke: 1, decoy: 1, emp: 0, cutter: 0, soles: 0, pick: 1 },
  };
}

export { WINGS, SHOP_STOCK, STEP };
