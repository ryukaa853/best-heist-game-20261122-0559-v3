// Screenshot scenes and the autoplay pilot. Scenes stage a real WingWorld into a
// fixed, deterministic frame (same seed, same steps, same pixels every run) so the
// screenshots are honest renders of the game. The pilot plays the real rules with
// a breadth-first path and cone checks, which is also the winnability proof.
import { TILE, STEP, GUARD_VIEW, CAMERA_VIEW, CONE_HALF_ANGLE } from './config.js';
import { WingWorld, freshCarry } from './world.js';

/** Walkable tile for pathing. */
function walkable(world, cx, cy) {
  if (cy < 0 || cy >= world.grid.length || cx < 0 || cx >= world.grid[0].length) return false;
  return world.grid[cy][cx] !== '#';
}

/** The safest tile to flee to: far from every guard, not absurdly far away. */
function fleeGoal(world) {
  let best = { x: 1, y: 1 };
  let bestScore = -Infinity;
  for (let ty = 1; ty < 17; ty += 2) {
    for (let tx = 1; tx < 31; tx += 2) {
      if (!walkable(world, tx, ty)) continue;
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      let m = Infinity;
      for (const g of world.guards) m = Math.min(m, Math.hypot(cx - g.x, cy - g.y));
      const score = m - Math.hypot(cx - world.player.x, cy - world.player.y) * 0.25;
      if (score > bestScore) { bestScore = score; best = { x: tx, y: ty }; }
    }
  }
  return best;
}

/** A tile is a real hiding spot only if NO angle of any camera sweep can
 * ever reach it — the instantaneous facing is not enough to plan on. */
function tileSafeForHide(world, cx, cy) {
  if (tileDanger(world, cx, cy, 70)) return false;
  const x = cx * TILE + TILE / 2, y = cy * TILE + TILE / 2;
  for (const cam of world.cameras) {
    if (cam.disabledT > 0) continue;
    const dx = x - cam.x, dy = y - cam.y;
    if (Math.hypot(dx, dy) < CAMERA_VIEW) {
      let a = Math.atan2(dy, dx) - cam.base;
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      if (Math.abs(a) <= (cam.sweep ?? 0) + CONE_HALF_ANGLE) return false;
    }
  }
  return true;
}

/** BFS out from the thief to the nearest tile no eye can see — a hiding spot. */
function nearestSafeTile(world) {
  const sx = Math.floor(world.player.x / TILE), sy = Math.floor(world.player.y / TILE);
  const seen = new Set([sy * 64 + sx]);
  const queue = [{ x: sx, y: sy }];
  let head = 0;
  while (head < queue.length && head < 2000) {
    const n = queue[head++];
    if (tileSafeForHide(world, n.x, n.y)) return n;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = n.x + dx, ny = n.y + dy;
      if (!walkable(world, nx, ny) || seen.has(ny * 64 + nx)) continue;
      seen.add(ny * 64 + nx);
      queue.push({ x: nx, y: ny });
    }
  }
  // No tile on the map is fully safe right now: fall back to the start
  // corner (far from every patrol) instead of standing still where we are —
  // the current tile may be a live laser beam or a watched corridor.
  return { x: Math.floor(world.start.x / TILE), y: Math.floor(world.start.y / TILE) };
}

/** True when the tile sits on a laser beam that is live right now.
 * The world stores beams in pixels (x1 = tile*40, y1 = tile*40+20), so
 * convert back to tiles before comparing. */
function onLaserTile(world, cx, cy) {
  for (const l of world.lasers) {
    if (l.disabledT > 0) continue;
    const cyc = (world.time + l.phase) % l.period;
    if (cyc >= l.period * l.duty) continue;
    if (l.x1 === l.x2) {
      // Vertical beam: the line is the left edge of tile l.x1/40.
      const bx = l.x1 / TILE;
      const yTop = Math.min(l.y1, l.y2) / TILE - 0.5;
      const yBot = Math.max(l.y1, l.y2) / TILE - 0.5;
      if (cx === bx && cy >= yTop && cy <= yBot) return true;
    } else {
      // Horizontal beam: the line runs through the middle of tile row (l.y1-20)/40.
      const by = (l.y1 - TILE / 2) / TILE;
      const xL = Math.min(l.x1, l.x2) / TILE;
      const xR = Math.max(l.x1, l.x2) / TILE;
      if (cy === by && cx >= xL && cx < xR) return true;
    }
  }
  return false;
}

/** A guard the thief must run from: chasing, or investigating the thief's
 * own position and close (a decoy point does not count — that guard is
 * walking away to look at a chime). */
function isThreat(world, g) {
  if (g.state === 'chase') return true;
  if (g.state === 'investigate' && g.lastSeen) {
    const p = world.player;
    const huntingMe = Math.hypot(g.lastSeen.x - p.x, g.lastSeen.y - p.y) < 60;
    const close = Math.hypot(g.x - p.x, g.y - p.y) < 200;
    return huntingMe && close;
  }
  return false;
}

function tileDanger(world, cx, cy, guardRadius) {
  if (world.smokeT > 0) return false; // smoke blinds every eye
  // A hiding plant is a safe place to wait: standing still in one hides the thief.
  if (world.grid[cy] && world.grid[cy][cx] === 'H') return false;
  const x = cx * TILE + TILE / 2, y = cy * TILE + TILE / 2;
  // Never plan a step through a guard's body: a touch is a bust. While
  // fleeing, keep a wider berth around the chaser.
  for (const g of world.guards) {
    const r = g.state === 'chase' ? (guardRadius ?? 130) : 70;
    if (Math.hypot(x - g.x, y - g.y) < r) return true;
  }
  for (const g of world.guards) {
    // Match the world's own sight ranges: elites see far, hounds see short.
    const range = g.kind === 'elite' ? GUARD_VIEW * 1.35 : g.kind === 'dog' ? GUARD_VIEW * 0.7 : GUARD_VIEW;
    const dx = x - g.x, dy = y - g.y;
    if (Math.hypot(dx, dy) < range) {
      const facing = g.facing;
      let a = Math.atan2(dy, dx) - facing;
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      if (Math.abs(a) <= 0.46) return true;
    }
  }
  for (const cam of world.cameras) {
    if (cam.disabledT > 0) continue;
    const facing = cam.facing ?? cam.base;
    const dx = x - cam.x, dy = y - cam.y;
    if (Math.hypot(dx, dy) < CAMERA_VIEW) {
      let a = Math.atan2(dy, dx) - facing;
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      if (Math.abs(a) <= CONE_HALF_ANGLE) return true;
    }
  }
  // A live laser beam is a wall of light: never plan a step onto it while
  // it is on. (When it is off, the tile is free.)
  if (onLaserTile(world, cx, cy)) return true;
  return false;
}

function findPath(world, sx, sy, tx, ty, avoidDanger) {
  const key = (x, y) => `${x},${y}`;
  const prev = new Map();
  const queue = [[sx, sy]];
  prev.set(key(sx, sy), null);
  while (queue.length) {
    const [cx, cy] = queue.shift();
    if (cx === tx && cy === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!walkable(world, nx, ny) || prev.has(key(nx, ny))) continue;
      if (avoidDanger && tileDanger(world, nx, ny) && !(nx === tx && ny === ty)) continue;
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

/** Steer the thief along a path, waiting out cones. Returns a synthetic input. */
export class Autopilot {
  constructor() {
    this.path = null;
    this.repathIn = 0;
    this.waitT = 0;
    this.stuckT = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.toolT = 0;
    this.retreatSteps = 0;
  }

  /** The flee refuge, sticky for ~half a second so the route does not flip
   * with every guard step. */
  stickyFleeGoal(world) {
    if (!this.fleeGoalT || this.fleeGoalT <= 0) {
      this.fleeGoal = fleeGoal(world);
      this.fleeGoalT = 30;
    }
    this.fleeGoalT -= 1;
    return this.fleeGoal;
  }

  drive(world) {
    const p = world.player;
    const input = { up: false, down: false, left: false, right: false, sneak: true, run: false, interact: false, mouseX: 0, mouseY: 0, mouseClicked: false };
    // Retreating: the goal below becomes the start tile, routed by the same
    // pathfinding as everything else, for the next two seconds.
    const retreating = this.retreatSteps > 0;
    if (retreating) this.retreatSteps -= 1;
    this.toolT -= STEP;
    const chased = world.guards.some((g) => isThreat(world, g));
    // Hide only for a bounded time: if the alarm will not cool, the thief
    // goes back to work instead of hiding forever in the dark.
    if (!chased && world.alarm > 80) {
      this.hideT = (this.hideT ?? 0) + STEP;
    } else {
      this.hideT = 0;
    }
    // Once the target is taken, there is no more hiding: the getaway is a
    // sprint to the exit (a lock pick opens it even in lockdown).
    const getaway = !!(world.target && world.target.taken);
    const hiding = !chased && world.alarm > 80 && (this.hideT ?? 0) < 15 && !getaway;
    // Burn smoke the moment a chase starts or a guard is close to
    // spotting the thief — but always keep one pellet in reserve for the
    // target grab, and never spend one while standing on the target: the
    // grab-smoke below needs it, and its cooldown would block the grab.
    const nearTarget = world.target && !world.target.taken
      && Math.hypot(world.target.x - p.x, world.target.y - p.y) < 40;
    const hot = world.guards.some((g) => g.suspicion > 0.5);
    if ((chased || hot) && (world.tools.smoke ?? 0) > 1 && this.toolT <= 0) {
      world.useTool('smoke');
      this.toolT = 5;
    }
    // A chase starting or ending invalidates the old route at once.
    if (chased !== this.wasChased) { this.path = null; this.wasChased = chased; }
    // Spend tools like a thief: a decoy to shake a chase, an EMP to blind a
    // camera that has the thief in its cone.
    if (this.toolT <= 0) {
      if (chased && (world.tools.decoy ?? 0) > 0) {
        world.useTool('decoy', 60, 660);
        this.toolT = 4;
      } else if ((world.tools.emp ?? 0) > 0 && world.cameras.some((c) => world.playerSeenByCamera(c))) {
        world.useTool('emp');
        this.toolT = 4;
      }
    }
    // Grab anything in reach first — but never stand still for a channel
    // while a guard is close or chasing: break off, flee, come back later.
    // Exception: standing ON the target with a guard 100-150px out, burn a
    // smoke pellet and grab under its cover — the 4s blind outlasts the
    // 1.2s channel, and waiting for a perfect 150px window wastes the run.
    const nearestGuardD = Math.min(...world.guards.map((g) => Math.hypot(g.x - p.x, g.y - p.y)));
    const safeToGrab = !chased && nearestGuardD > 150;
    if (nearTarget && !chased && nearestGuardD > 100 && nearestGuardD <= 150
      && (world.tools.smoke ?? 0) > 0 && world.smokeT <= 0) {
      // The grab-smoke bypasses the tool cooldown (it must fire exactly
      // when the guard is in range) but never stacks on an active cloud:
      // one pellet covers the whole 1.2s channel.
      world.useTool('smoke');
      this.toolT = 5;
      input.interact = true;
      return input;
    }
    const nearLoot = world.nearestLoot(38);
    if (nearLoot && safeToGrab) { input.interact = true; return input; }
    if (nearTarget && safeToGrab) {
      input.interact = true; return input;
    }
    // The goal: the target, then the exit — unless a guard is chasing, in
    // which case the goal is the point farthest from the chaser: run AWAY from
    // it, never through it. Retreating uses the start tile as its safe goal.
    const chaser = world.guards.find((g) => isThreat(world, g));
    // HIDE MODE: alarm high but nobody chasing — the thief is being seen by
    // a camera or a distant cone. Go dark: move to the nearest tile no eye
    // can see and wait there until the alarm cools.
    let goal;
    if (chaser) {
      // Flee to the safest tile on the map: far from every guard at once,
      // so a second chaser cannot be waiting on the escape route — unless
      // the target is already taken, in which case the exit IS the refuge:
      // sprinting for it beats hiding from a chase the thief can outrun.
      goal = getaway
        ? { x: Math.floor(world.exit.x / TILE), y: Math.floor(world.exit.y / TILE) }
        : this.stickyFleeGoal(world);
    } else if (hiding) {
      if (!this.hideGoalT || this.hideGoalT <= 0) {
        this.hideGoal = nearestSafeTile(world);
        this.hideGoalT = 30;
      }
      this.hideGoalT -= 1;
      goal = this.hideGoal;
    } else if (retreating) {
      goal = { x: Math.floor(world.start.x / TILE), y: Math.floor(world.start.y / TILE) };
    } else if (world.target && !world.target.taken) {
      goal = { x: Math.floor(world.target.x / TILE), y: Math.floor(world.target.y / TILE) };
    } else {
      goal = { x: Math.floor(world.exit.x / TILE), y: Math.floor(world.exit.y / TILE) };
    }
    const sx = Math.floor(p.x / TILE), sy = Math.floor(p.y / TILE);
    // Standing on a live laser beam: get off it NOW — step to a safe
    // neighbour (south first, away from the horizontal beam) or retreat.
    // This runs before the path-following below, because a one-waypoint
    // path (standing at the goal) would otherwise return before it.
    if (!chased && !retreating && onLaserTile(world, sx, sy)) {
      for (const [dx, dy] of [[0, 1], [0, -1], [-1, 0], [1, 0]]) {
        const nx = sx + dx, ny = sy + dy;
        if (walkable(world, nx, ny) && !tileDanger(world, nx, ny) && !onLaserTile(world, nx, ny)) {
          const cxp = nx * TILE + TILE / 2, cyp = ny * TILE + TILE / 2;
          if (cxp > p.x + 8) input.right = true; else if (cxp < p.x - 8) input.left = true;
          if (cyp > p.y + 8) input.down = true; else if (cyp < p.y - 8) input.up = true;
          input.sneak = true;
          this.waitT = 0;
          return input;
        }
      }
      this.retreatSteps = 120;
      this.path = null;
      this.waitT = 0;
      return input;
    }
    // Commit to a route: repath only when the goal itself changes, the
    // path is gone, or the thief is stuck — repathing every few frames
    // lets a sweeping camera flip the "best" route back and forth and the
    // thief oscillates in place instead of moving. Two exceptions: after a
    // bust the thief respawns at the start and the old route is dead, and
    // on the getaway (or while fleeing) the route must stay fresh as the
    // patrols move, because the thief no longer waits out danger.
    if (world.bustsLeft !== this.lastBusts) {
      this.path = null;
      this.goalKey = null;
      this.lastBusts = world.bustsLeft;
    }
    const goalKey = `${goal.x},${goal.y}:${chased ? 'F' : hiding ? 'H' : retreating ? 'R' : 'G'}`;
    this.repathIn = (this.repathIn ?? 0) - 1;
    const urgent = getaway || chased;
    if (!this.path || this.goalKey !== goalKey || (urgent && this.repathIn <= 0)) {
      this.path = findPath(world, sx, sy, goal.x, goal.y, true)
        ?? findPath(world, sx, sy, goal.x, goal.y, false);
      this.goalKey = goalKey;
      this.repathIn = 30;
    }
    if (!this.path) return input;
    // A one-waypoint path means the goal is the next tile: still walk to
    // it unless already standing on it — the old "length < 2 returns"
    // froze the thief a tile short of the target.
    if (this.path.length < 2) {
      const [lx, ly] = this.path[0];
      if (Math.hypot(lx * TILE + TILE / 2 - p.x, ly * TILE + TILE / 2 - p.y) < 14) return input;
    }
    // Skip waypoints already reached.
    while (this.path.length > 1 && Math.hypot(this.path[0][0] * TILE + TILE / 2 - p.x, this.path[0][1] * TILE + TILE / 2 - p.y) < 14) this.path.shift();
    const [wx, wy] = this.path[0];
    const tx = wx * TILE + TILE / 2, ty = wy * TILE + TILE / 2;
    // Wait if the next tile is watched right now — but never wait forever under
    // a locked-on cone: burn a smoke pellet, and if there is none, risk the dash.
    // A chase overrides waiting entirely: run for the goal.
    if (tileDanger(world, wx, wy) && Math.hypot(tx - p.x, ty - p.y) > 30 && !chased && !retreating && !getaway) {
      this.waitT += STEP;
      // Never stand still in a patrol's path: if this tile is watched too, or
      // a guard is closing in, step aside to a safe neighbour instead. The
      // sidestep is sticky until reached — re-picking it every frame lets a
      // sweeping cone flip the direction and the thief dithers in place.
      const curDanger = tileDanger(world, sx, sy) || Math.min(...world.guards.map((g) => Math.hypot(g.x - p.x, g.y - p.y))) < 110;
      if (curDanger) {
        if (!this.sideStep || Math.hypot(this.sideStep.x * TILE + TILE / 2 - p.x, this.sideStep.y * TILE + TILE / 2 - p.y) < 14) {
          this.sideStep = null;
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = sx + dx, ny = sy + dy;
            if (walkable(world, nx, ny) && !tileDanger(world, nx, ny)) { this.sideStep = { x: nx, y: ny }; break; }
          }
        }
        if (this.sideStep) {
          const cxp = this.sideStep.x * TILE + TILE / 2, cyp = this.sideStep.y * TILE + TILE / 2;
          if (cxp > p.x + 8) input.right = true; else if (cxp < p.x - 8) input.left = true;
          if (cyp > p.y + 8) input.down = true; else if (cyp < p.y - 8) input.up = true;
          input.sneak = true;
          this.waitT = 0;
          return input;
        }
        // No safe neighbour: the corridor itself is watched. Retreat to the
        // start and try again on a later patrol pass instead of being caught.
        this.retreatSteps = 120;
        this.path = null;
        this.waitT = 0;
        return input;
      }
      if (this.waitT > 3 && (world.tools.smoke ?? 0) > 0) {
        world.useTool('smoke');
        this.waitT = 0;
      } else if (this.waitT > 6) {
        // The corridor is watched on every patrol pass: give up this
        // approach, retreat to the start, and try again fresh instead of
        // waiting here until the run times out.
        this.retreatSteps = 120;
        this.path = null;
        this.waitT = 0;
      } else {
        return input;
      }
    }
    this.waitT = 0;
    const dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 6) {
      if (dx > 8) input.right = true; else if (dx < -8) input.left = true;
      if (dy > 8) input.down = true; else if (dy < -8) input.up = true;
      // Sneak only near watchers; walk otherwise so the run finishes in time.
      // Chased or retreating: run — the guards' chase speed is capped below a sprint.
      if (chased || retreating) { input.sneak = false; input.run = true; }
      else input.sneak = tileDanger(world, wx, wy) || tileDanger(world, sx, sy);
    }
    if (Math.hypot(p.x - this.lastX, p.y - this.lastY) < 0.5 && (input.up || input.down || input.left || input.right)) {
      this.stuckT += STEP;
      if (this.stuckT > 3) { this.path = null; this.stuckT = 0; }
    } else this.stuckT = 0;
    this.lastX = p.x; this.lastY = p.y;
    return input;
  }
}

/**
 * Stage a named scene on a fresh game object. Returns { screen, world, carry }.
 * cover: wing I mid-heist — thief crossing the atrium, cones sweeping, cameras
 * watching, the Chalice glowing, alarm at 38. wing3: the Sculpture Court with
 * lasers live and the elite guard's long cone. shop: the Fence after wing II.
 * finale: wing V, crown in hand, alarm at 72, racing for the exit.
 */
export function stageShot(name, game) {
  if (name === 'shop') {
    const carry = freshCarry();
    carry.coins = 640; carry.score = 1890; carry.targetsTaken = 2;
    carry.tools = { smoke: 1, decoy: 2, emp: 1, cutter: 0, soles: 0, pick: 1 };
    game.showShop(carry, 1);
    return { screen: 'shop' };
  }
  const wingIndex = name === 'wing3' ? 2 : name === 'finale' ? 4 : 0;
  const carry = freshCarry();
  if (name === 'finale') { carry.coins = 2310; carry.score = 4860; carry.targetsTaken = 4; }
  if (name === 'wing3') { carry.coins = 980; carry.score = 2140; carry.targetsTaken = 2; }
  const world = new WingWorld(wingIndex, carry);
  game.startWing(world);
  if (name === 'cover') {
    world.player.x = 15 * TILE + 20; world.player.y = 8 * TILE + 20;
    world.player.facing = Math.PI;
    world.alarm = 38;
    world.loot[0].taken = true; world.loot[1].taken = true;
    world.coins += 200; world.wingLoot += 200; world.score += 200;
    world.time = 12;
    for (let i = 0; i < 12 * 60; i += 1) world.step(STEP, { up: false, down: false, left: false, right: false, sneak: false, run: false, interact: false });
    world.player.x = 15 * TILE + 20; world.player.y = 8 * TILE + 20;
    world.player.facing = Math.PI;
    world.alarm = 38;
  } else if (name === 'wing3') {
    world.player.x = 15 * TILE + 20; world.player.y = 13 * TILE + 20;
    world.player.facing = -Math.PI / 2;
    world.alarm = 55;
    world.loot[0].taken = true;
    world.time = 20;
    for (let i = 0; i < 20 * 60; i += 1) world.step(STEP, { up: false, down: false, left: false, right: false, sneak: false, run: false, interact: false });
    world.player.x = 15 * TILE + 20; world.player.y = 13 * TILE + 20;
    world.alarm = 55;
  } else if (name === 'finale') {
    world.target.taken = true;
    world.targetsTaken = 5;
    world.player.x = 17 * TILE + 20; world.player.y = 8 * TILE + 20;
    world.player.facing = 0;
    world.alarm = 72;
    world.time = 30;
    for (let i = 0; i < 30 * 60; i += 1) world.step(STEP, { up: false, down: false, left: false, right: false, sneak: false, run: false, interact: false });
    world.player.x = 17 * TILE + 20; world.player.y = 8 * TILE + 20;
    world.target.taken = true;
    world.alarm = 72;
  }
  return { screen: 'play', world };
}
