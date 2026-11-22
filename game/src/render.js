// All drawing: the museum, its watchers, the thief, and the HUD. The cover frame
// must read at a glance — safe cover, danger and loot are never the same colour.
import { TILE, VIEW_W, VIEW_H, HUD_H, FIELD_W, FIELD_H, COLOURS, CONE_HALF_ANGLE, CAMERA_VIEW, GUARD_VIEW } from './config.js';
import { WINGS, SHOP_STOCK } from './levels.js';

export function drawCone(ctx, x, y, facing, range, halfAngle, fill) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, range, facing - halfAngle, facing + halfAngle);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawTileFloor(ctx, world) {
  for (let y = 0; y < world.grid.length; y += 1) {
    for (let x = 0; x < world.grid[y].length; x += 1) {
      const t = world.grid[y][x];
      const px = x * TILE, py = HUD_H + y * TILE;
      if (t === '#') continue;
      ctx.fillStyle = t === ',' ? COLOURS.carpet : ((x + y) % 2 === 0 ? COLOURS.floorA : COLOURS.floorB);
      ctx.fillRect(px, py, TILE, TILE);
      if (t === ',') {
        ctx.strokeStyle = COLOURS.carpetEdge;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
      }
    }
  }
}

function drawWalls(ctx, world) {
  for (let y = 0; y < world.grid.length; y += 1) {
    for (let x = 0; x < world.grid[y].length; x += 1) {
      if (world.grid[y][x] !== '#') continue;
      const px = x * TILE, py = HUD_H + y * TILE;
      ctx.fillStyle = COLOURS.wall;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = COLOURS.wallTop;
      ctx.fillRect(px, py, TILE, 5);
      ctx.strokeStyle = 'rgba(255,220,150,0.08)';
      ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    }
  }
}

function drawGuard(ctx, g, world) {
  const y = g.y + HUD_H;
  const sees = world.playerSeenBy ? world.playerSeenBy(g) : false;
  const range = g.kind === 'elite' ? GUARD_VIEW * 1.35 : g.kind === 'dog' ? GUARD_VIEW * 0.7 : GUARD_VIEW;
  drawCone(ctx, g.x, y, g.facing, range, CONE_HALF_ANGLE, sees ? COLOURS.coneSeen : COLOURS.cone);
  const colour = g.kind === 'elite' ? COLOURS.guardElite : g.kind === 'dog' ? COLOURS.guardDog : g.kind === 'runner' ? COLOURS.runner : COLOURS.guard;
  ctx.beginPath(); ctx.arc(g.x, y, 14, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#0c0a08'; ctx.stroke();
  // Facing tick + eyes.
  ctx.beginPath(); ctx.moveTo(g.x, y);
  ctx.lineTo(g.x + Math.cos(g.facing) * 20, y + Math.sin(g.facing) * 20);
  ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  if (g.kind === 'dog') { ctx.fillText('🐕', g.x, y + 5); }
  else { ctx.fillStyle = '#fff'; ctx.fillText(g.kind === 'elite' ? 'E' : g.kind === 'runner' ? 'R' : 'G', g.x, y + 5); }
  if (g.suspicion > 0.25) {
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = g.suspicion >= 1 ? '#ff5040' : '#ffd65a';
    ctx.fillText(g.suspicion >= 1 ? '!' : '?', g.x, y - 22);
  }
  if (g.state === 'chase') {
    ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#ff5040';
    ctx.fillText('CHASING', g.x, y + 30);
  }
}

function drawCamera(ctx, cam, world) {
  const y = cam.y + HUD_H;
  const facing = cam.facing ?? cam.base;
  const disabled = cam.disabledT > 0 || world.empT > 0;
  if (!disabled) {
    drawCone(ctx, cam.x, y, facing, CAMERA_VIEW, CONE_HALF_ANGLE,
      world.playerSeenByCamera && world.playerSeenByCamera(cam) ? COLOURS.coneSeen : 'rgba(127,227,208,0.16)');
  }
  ctx.beginPath(); ctx.arc(cam.x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = disabled ? '#555' : COLOURS.camera; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#0c0a08'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cam.x, y);
  ctx.lineTo(cam.x + Math.cos(facing) * 16, y + Math.sin(facing) * 16);
  ctx.lineWidth = 3; ctx.strokeStyle = disabled ? '#888' : '#eafffb'; ctx.stroke();
}

function drawLaser(ctx, laser, world) {
  const on = world.laserOn(laser);
  const y1 = laser.y1 + HUD_H, y2 = laser.y2 + HUD_H;
  ctx.strokeStyle = on ? COLOURS.laser : 'rgba(255,77,109,0.18)';
  ctx.lineWidth = on ? 3 : 1.5;
  ctx.setLineDash(on ? [] : [6, 6]);
  ctx.beginPath(); ctx.moveTo(laser.x1, y1); ctx.lineTo(laser.x2, y2); ctx.stroke();
  ctx.setLineDash([]);
  for (const [x, y] of [[laser.x1, y1], [laser.x2, y2]]) {
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = '#c9c2b4'; ctx.fill();
  }
}

function drawLoot(ctx, world) {
  for (const item of world.loot) {
    if (item.taken) continue;
    const y = item.y + HUD_H;
    const bob = Math.sin(world.time * 3 + item.x) * 2;
    ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
    const glyph = item.kind === 'l' ? '💰' : item.kind === 'g' ? '💎' : item.kind === 'p' ? '🖼️' : '🏺';
    ctx.fillText(glyph, item.x, y + 8 + bob);
    ctx.beginPath(); ctx.arc(item.x, y, 17, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(242,193,78,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (world.target && !world.target.taken) {
    const y = world.target.y + HUD_H;
    const pulse = 0.5 + Math.sin(world.time * 4) * 0.25;
    ctx.beginPath(); ctx.arc(world.target.x, y, 24 + pulse * 4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(242,193,78,${0.5 + pulse * 0.4})`; ctx.lineWidth = 3; ctx.stroke();
    ctx.font = '30px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('👑', world.target.x, y + 11);
    ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = COLOURS.gold;
    ctx.fillText('TARGET', world.target.x, y - 32);
  }
}

export function drawWorld(ctx, world) {
  ctx.fillStyle = '#100d0a';
  ctx.fillRect(0, HUD_H, FIELD_W, FIELD_H);
  drawTileFloor(ctx, world);
  // Vents and plants under everything else.
  for (const v of world.vents) {
    ctx.fillStyle = COLOURS.vent;
    ctx.fillRect(v.x - 14, v.y + HUD_H - 14, 28, 28);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath(); ctx.moveTo(v.x - 11, v.y + HUD_H + i * 7); ctx.lineTo(v.x + 11, v.y + HUD_H + i * 7); ctx.stroke();
    }
  }
  for (let y = 0; y < world.grid.length; y += 1) {
    for (let x = 0; x < world.grid[y].length; x += 1) {
      if (world.grid[y][x] !== 'H') continue;
      const px = x * TILE + TILE / 2, py = HUD_H + y * TILE + TILE / 2;
      ctx.font = '26px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🌿', px, py + 9);
    }
  }
  // Exit door.
  const ex = world.exit, ey = world.exit.y + HUD_H;
  ctx.fillStyle = world.target && world.target.taken ? '#43d68a' : '#5a5148';
  ctx.fillRect(ex - 18, ey - 18, 36, 36);
  ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
  ctx.fillText(world.lockdown ? 'SEALED' : 'EXIT', ex, ey + 4);
  drawLoot(ctx, world);
  for (const l of world.lasers) drawLaser(ctx, l, world);
  for (const cam of world.cameras) drawCamera(ctx, cam, world);
  for (const g of world.guards) drawGuard(ctx, g, world);
  // Decoy chimes.
  for (const d of world.decoys) {
    ctx.beginPath(); ctx.arc(d.x, d.y + HUD_H, 10 + Math.sin(world.time * 10) * 3, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd65a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = '16px sans-serif'; ctx.fillText('🔔', d.x, d.y + HUD_H + 5);
  }
  // The thief.
  const p = world.player, py = p.y + HUD_H;
  if (world.smokeT > 0) {
    ctx.beginPath(); ctx.arc(p.x, py, 46, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200,200,200,0.35)'; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(p.x, py, 13, 0, Math.PI * 2);
  ctx.fillStyle = p.hidden ? '#3f7a4d' : COLOURS.thiefCloak; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = p.sneaking ? '#43d68a' : COLOURS.thief; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(p.x, py);
  ctx.lineTo(p.x + Math.cos(p.facing) * 18, py + Math.sin(p.facing) * 18);
  ctx.lineWidth = 3; ctx.strokeStyle = COLOURS.thief; ctx.stroke();
  ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.fillText('SABLE', p.x, py - 20);
  if (world.channel) {
    const frac = world.channel.t / world.channel.need;
    ctx.fillStyle = '#111'; ctx.fillRect(p.x - 22, py - 36, 44, 7);
    ctx.fillStyle = COLOURS.gold; ctx.fillRect(p.x - 21, py - 35, 42 * Math.min(1, frac), 5);
  }
  drawWalls(ctx, world);
  if (world.lockdown) {
    ctx.fillStyle = 'rgba(229,72,77,0.10)';
    ctx.fillRect(0, HUD_H, FIELD_W, FIELD_H);
    ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff6b60';
    ctx.fillText('⚠ LOCKDOWN ⚠', VIEW_W / 2, HUD_H + 40);
  }
  if (world.caughtFlash > 0) {
    ctx.fillStyle = `rgba(229,72,77,${Math.min(0.45, world.caughtFlash)})`;
    ctx.fillRect(0, HUD_H, FIELD_W, FIELD_H);
  }
}

export function drawHud(ctx, world, screen) {
  ctx.fillStyle = COLOURS.hud;
  ctx.fillRect(0, 0, VIEW_W, HUD_H);
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(0, HUD_H - 2, VIEW_W, 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = '#f2c14e';
  ctx.fillText('THE GILDED HOUR', 16, 20);
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#cfc6b4';
  const wing = WINGS[world.wingIndex];
  ctx.fillText(wing.name, 16, 44);
  // Alarm meter — the tension dial, always visible.
  const ax = 330, aw = 300;
  ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = world.alarm > 66 ? '#ff6b60' : world.alarm > 33 ? '#f2c14e' : '#43d68a';
  ctx.fillText(world.lockdown ? '🚨 LOCKDOWN' : `ALARM ${Math.floor(world.alarm)}%`, ax, 20);
  ctx.fillStyle = '#2a2118'; ctx.fillRect(ax, 32, aw, 16);
  const alarmColour = world.alarm > 66 ? COLOURS.alarmHigh : world.alarm > 33 ? COLOURS.alarmMid : COLOURS.alarmLow;
  ctx.fillStyle = alarmColour; ctx.fillRect(ax + 1, 33, Math.max(0, (aw - 2) * world.alarm / 100), 14);
  ctx.strokeStyle = '#6b5a3e'; ctx.lineWidth = 1; ctx.strokeRect(ax + 0.5, 32.5, aw, 16);
  // Objective.
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#e8e4d8';
  const objective = world.target && world.target.taken ? 'Target secured — reach the EXIT' : `Steal: ${wing.targetName}`;
  ctx.fillText(objective, ax, 44 + 14);
  // Coins, busts, tools.
  ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = COLOURS.gold;
  ctx.fillText(`💰 ${world.coins}`, 680, 20);
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#cfc6b4';
  ctx.fillText(`wing loot ${world.wingLoot} · score ${world.score}`, 680, 44);
  ctx.font = '16px sans-serif';
  ctx.fillText(`Busts: ${'♥'.repeat(Math.max(0, world.bustsLeft))}${'♡'.repeat(Math.max(0, 3 - world.bustsLeft))}`, 900, 20);
  ctx.font = '12px sans-serif'; ctx.fillStyle = '#9fb8ff';
  const toolLine = ['smoke', 'decoy', 'emp'].map((id, i) => `${i + 1}:${id}×${world.tools[id] ?? 0}`).join('  ');
  ctx.fillText(toolLine, 900, 44);
  if (world.messageT > 0) {
    ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    const w = ctx.measureText(world.message).width + 24;
    ctx.fillRect(VIEW_W / 2 - w / 2, HUD_H + 8, w, 28);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(world.message, VIEW_W / 2, HUD_H + 23);
  }
  ctx.textBaseline = 'alphabetic';
}

export function drawTitle(ctx, best) {
  ctx.fillStyle = '#14100c'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.font = 'bold 64px Georgia, serif'; ctx.fillStyle = COLOURS.gold;
  ctx.fillText('THE GILDED HOUR', VIEW_W / 2, 170);
  ctx.font = '22px Georgia, serif'; ctx.fillStyle = '#e8e4d8';
  ctx.fillText('A five-wing stealth heist at the Aurelia Museum', VIEW_W / 2, 220);
  ctx.font = '17px sans-serif'; ctx.fillStyle = '#cfc6b4';
  const lines = [
    'You are Sable, the thief the museum never sees coming.',
    'Read the guards’ vision cones. Time the sweeping cameras. Slip the lasers.',
    'Lift the loot, steal each wing’s masterpiece, and reach the exit before the alarm locks you in.',
    'Five wings. Six tools at the Fence. Three busts — and then the night is over.',
  ];
  lines.forEach((line, i) => ctx.fillText(line, VIEW_W / 2, 290 + i * 30));
  ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#43d68a';
  ctx.fillText('▶  Press ENTER or click to begin the heist', VIEW_W / 2, 470);
  ctx.font = '15px sans-serif'; ctx.fillStyle = '#9a8f7a';
  ctx.fillText('WASD / arrows move · SHIFT sneak · E grab / vent · 1 smoke · 2 decoy (click to throw) · 3 EMP · P pause · M mute', VIEW_W / 2, 520);
  ctx.fillText('Hide in the plants 🌿 · Vents crawl you past every eye · Getting caught costs a quarter of the wing’s loot', VIEW_W / 2, 548);
  if (best > 0) { ctx.fillStyle = COLOURS.gold; ctx.fillText(`Best score so far: ${best}`, VIEW_W / 2, 600); }
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#6b5a3e';
  ctx.fillText('Original game — art, names, levels and sound made for this entry. No network requests.', VIEW_W / 2, 660);
}

export function drawShop(ctx, carry, wingIndex, selected) {
  ctx.fillStyle = '#14100c'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.font = 'bold 40px Georgia, serif'; ctx.fillStyle = COLOURS.gold;
  ctx.fillText('THE FENCE', VIEW_W / 2, 90);
  ctx.font = '18px sans-serif'; ctx.fillStyle = '#e8e4d8';
  ctx.fillText(`Wing ${wingIndex + 1} cleared. The Fence buys your silence — and sells you tools.`, VIEW_W / 2, 130);
  ctx.fillStyle = COLOURS.gold; ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`Your coins: ${carry.coins}`, VIEW_W / 2, 168);
  ctx.textAlign = 'left';
  SHOP_STOCK.forEach((item, i) => {
    const y = 210 + i * 62;
    const owned = carry.tools[item.id] ?? 0;
    const afford = carry.coins >= item.price;
    ctx.fillStyle = i === selected ? '#2e2620' : '#1c1712';
    ctx.fillRect(240, y, 800, 52);
    ctx.strokeStyle = i === selected ? COLOURS.gold : '#3a2f22'; ctx.lineWidth = i === selected ? 2 : 1;
    ctx.strokeRect(240.5, y + 0.5, 800, 52);
    ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = afford ? '#e8e4d8' : '#7a6a55';
    ctx.fillText(`${i + 1}. ${item.name} — ${item.price} coins  (own ${owned})`, 260, y + 21);
    ctx.font = '14px sans-serif'; ctx.fillStyle = '#9a8f7a';
    ctx.fillText(item.desc, 260, y + 42);
  });
  ctx.textAlign = 'center'; ctx.font = '16px sans-serif'; ctx.fillStyle = '#cfc6b4';
  ctx.fillText('Click a tool or press its number to buy · ENTER to enter the next wing', VIEW_W / 2, 610);
  ctx.fillText(`Next: ${WINGS[wingIndex + 1].name} — ${WINGS[wingIndex + 1].brief}`, VIEW_W / 2, 644);
}

export function drawEnd(ctx, title, lines, score, best) {
  ctx.fillStyle = 'rgba(10,8,6,0.88)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.font = 'bold 52px Georgia, serif'; ctx.fillStyle = COLOURS.gold;
  ctx.fillText(title, VIEW_W / 2, 240);
  lines.forEach((line, i) => {
    ctx.font = '19px sans-serif'; ctx.fillStyle = '#e8e4d8';
    ctx.fillText(line, VIEW_W / 2, 310 + i * 32);
  });
  ctx.font = 'bold 24px sans-serif'; ctx.fillStyle = COLOURS.gold;
  ctx.fillText(`Final score: ${score}`, VIEW_W / 2, 310 + lines.length * 32 + 30);
  if (best > 0) { ctx.font = '16px sans-serif'; ctx.fillStyle = '#cfc6b4'; ctx.fillText(`Best: ${best}`, VIEW_W / 2, 350 + lines.length * 32 + 30); }
  ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#43d68a';
  ctx.fillText('Press R to steal again', VIEW_W / 2, 400 + lines.length * 32 + 30);
}
