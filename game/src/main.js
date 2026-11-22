// Entry point: screens, the fixed-step loop, tools, shop flow, autoplay and shots.
// Screens: title -> play (five wings, Fence shop between them) -> win / gameover.
import { VIEW_W, VIEW_H, STEP } from './config.js';
import { WingWorld, freshCarry, buyTool } from './world.js';
import { drawWorld, drawHud, drawTitle, drawShop, drawEnd } from './render.js';
import { Input } from './input.js';
import { SoundKit } from './audio.js';
import { Autopilot, stageShot } from './shots.js';
import { WINGS, SHOP_STOCK } from './levels.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VIEW_W;
canvas.height = VIEW_H;

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const autoplay = params.get('autoplay') === '1';

export class Game {
  constructor() {
    this.input = new Input(canvas);
    this.sound = new SoundKit();
    this.screen = 'title';
    this.world = null;
    this.carry = freshCarry();
    this.best = Number(window.localStorage.getItem('gilded-hour-best') ?? 0) || 0;
    this.paused = false;
    this.shopSelected = 0;
    this.acc = 0;
    this.last = 0;
    this.frozen = false;
    this.pilot = new Autopilot();
    this.autoLog = [];
    this.result = null;
    this.shopWing = 0;
    canvas.addEventListener('mousedown', () => this.sound.ensure());
    window.addEventListener('keydown', () => this.sound.ensure());
  }

  startWing(world) {
    this.world = world;
    this.screen = 'play';
    this.pilot = new Autopilot(); // a fresh pilot per wing: no stale path survives
  }

  newGame() {
    this.carry = freshCarry();
    this.startWing(new WingWorld(0, this.carry));
    this.world.say(WINGS[0].brief);
  }

  showShop(carry, clearedWing) {
    this.carry = carry;
    this.shopWing = clearedWing;
    this.screen = 'shop';
    this.shopSelected = 0;
  }

  enterNextWing() {
    const next = this.shopWing + 1;
    if (next >= WINGS.length) { this.finishWin(); return; }
    const carry = { ...this.carry, tools: { ...this.carry.tools } };
    carry.tools.soles = 0; // soft soles last one wing only
    this.startWing(new WingWorld(next, carry));
    this.world.say(WINGS[next].brief);
    this.sound.wingClear();
  }

  finishWin() {
    this.screen = 'win';
    this.result = { status: 'won', score: this.carry.score, coins: this.carry.coins };
    if (this.carry.score > this.best) {
      this.best = this.carry.score;
      window.localStorage.setItem('gilded-hour-best', String(this.best));
    }
    this.sound.win();
    window.__heistResult = this.result;
  }

  finishGameOver() {
    this.screen = 'gameover';
    this.result = { status: 'gameover', score: this.carry.score, coins: this.carry.coins };
    if (this.carry.score > this.best) {
      this.best = this.carry.score;
      window.localStorage.setItem('gilded-hour-best', String(this.best));
    }
    this.sound.bust();
    window.__heistResult = this.result;
  }

  wingCleared() {
    const cleared = this.world.wingIndex;
    this.carry.coins = this.world.coins;
    this.carry.score = this.world.score;
    this.carry.targetsTaken = this.world.targetsTaken;
    this.carry.tools = { ...this.world.tools };
    this.carry.bustsLeft = this.world.bustsLeft;
    this.autoLog.push({ wing: cleared, status: 'cleared', score: this.carry.score, coins: this.carry.coins, time: this.world.time });
    if (cleared + 1 >= WINGS.length) { this.finishWin(); return; }
    this.showShop(this.carry, cleared);
    this.sound.wingClear();
  }

  handleKeys() {
    const input = this.input;
    if (input.wasPressed('m')) this.sound.toggleMute();
    if (this.screen === 'title') {
      if (input.wasPressed('enter') || input.mouse.clicked) { this.sound.click(); this.newGame(); }
      return;
    }
    if (this.screen === 'shop') {
      const n = Number(input.wasPressed('1') ? 1 : input.wasPressed('2') ? 2 : input.wasPressed('3') ? 3
        : input.wasPressed('4') ? 4 : input.wasPressed('5') ? 5 : input.wasPressed('6') ? 6 : 0);
      if (n >= 1 && n <= SHOP_STOCK.length) {
        if (buyTool(this.carry, SHOP_STOCK[n - 1].id)) this.sound.loot();
        else this.sound.click();
      }
      if (input.wasPressed('arrowup')) this.shopSelected = Math.max(0, this.shopSelected - 1);
      if (input.wasPressed('arrowdown')) this.shopSelected = Math.min(SHOP_STOCK.length - 1, this.shopSelected + 1);
      if (input.wasPressed('enter')) this.enterNextWing();
      if (input.mouse.clicked) {
        const y = Math.floor((input.mouse.y - 210) / 62);
        if (y >= 0 && y < SHOP_STOCK.length && input.mouse.x > 240 && input.mouse.x < 1040) {
          if (buyTool(this.carry, SHOP_STOCK[y].id)) this.sound.loot();
        }
      }
      return;
    }
    if (this.screen === 'win' || this.screen === 'gameover') {
      if (input.wasPressed('r')) { this.screen = 'title'; this.result = null; }
      return;
    }
    if (this.screen === 'play') {
      if (input.wasPressed('p')) { this.paused = !this.paused; return; }
      if (this.paused) return;
      if (input.wasPressed('1')) this.world.useTool('smoke');
      if (input.wasPressed('2')) this.world.useTool('decoy', input.mouse.x, input.mouse.y - 64);
      if (input.wasPressed('3')) this.world.useTool('emp');
    }
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    if (!this.last) this.last = now;
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.handleKeys();
    if (this.screen === 'play' && this.world && !this.paused && !this.frozen) {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        const input = autoplay ? this.pilot.drive(this.world) : this.input.read();
        const status = this.world.step(STEP, input);
        if (status === 'wingclear') { this.wingCleared(); break; }
        if (status === 'gameover') { this.finishGameOver(); break; }
        if (status === 'busted') {
          this.carry.bustsLeft = this.world.bustsLeft;
          this.carry.coins = this.world.coins;
          this.carry.score = this.world.score;
          this.sound.bust();
        }
      }
      // Sound cues on fresh events.
      for (const e of this.world.events.splice(0)) {
        if (e.type === 'loot') this.sound.loot();
        if (e.type === 'target') this.sound.target();
        if (e.type === 'bust') this.sound.bust();
      }
    }
    if (autoplay && this.screen === 'shop') {
      // Autoplay shops like a player: stock up on smoke and decoys first.
      for (const id of ['smoke', 'smoke', 'decoy', 'emp']) {
        const item = SHOP_STOCK.find((s) => s.id === id);
        if (item && this.carry.coins >= item.price) buyTool(this.carry, id);
      }
      this.enterNextWing();
    }
    if (autoplay && (this.screen === 'win' || this.screen === 'gameover')) {
      window.__heistAutoLog = this.autoLog;
    }
    this.draw();
    this.input.endFrame();
  }

  draw() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    if (this.screen === 'title') drawTitle(ctx, this.best);
    else if (this.screen === 'shop') drawShop(ctx, this.carry, this.shopWing, this.shopSelected);
    else if (this.screen === 'play' && this.world) {
      drawWorld(ctx, this.world);
      drawHud(ctx, this.world, 'play');
      if (this.paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText('PAUSED — press P to continue', VIEW_W / 2, VIEW_H / 2);
      }
    } else if (this.screen === 'win') {
      drawEnd(ctx, 'THE CROWN IS YOURS', [
        'Five wings. Five masterpieces. One clean getaway.',
        'Sable slips into the dawn with the Aurelia Crown —',
        'and the museum only notices at opening time.',
      ], this.carry.score, this.best);
    } else if (this.screen === 'gameover') {
      drawEnd(ctx, 'BUSTED', [
        'Three strikes, and the museum keeps its treasures.',
        'The Fence will not post bail twice.',
      ], this.carry.score, this.best);
    }
  }
}

const game = new Game();
window.__heist = game;
window.__heistResult = null;
if (shotName) {
  stageShot(shotName, game);
  game.frozen = true;
} else if (autoplay) {
  game.newGame();
}
requestAnimationFrame((t) => game.frame(t));
