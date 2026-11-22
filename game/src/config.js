// Shared constants for The Gilded Hour — a top-down stealth heist across five wings
// of the Aurelia Museum. One tile = 40 px on a 1280x800 canvas; the HUD bar sits above
// the playfield. All colours are chosen so safe cover, danger and loot read at a glance.
export const TILE = 40;
export const VIEW_W = 1280;
export const VIEW_H = 800;
export const HUD_H = 64;
export const FIELD_W = VIEW_W;
export const FIELD_H = VIEW_H - HUD_H;

export const STEP = 1 / 60;

export const PLAYER_R = 13;
export const WALK_SPEED = 165;
export const SNEAK_SPEED = 92;
export const VENT_SPEED = 62;

export const ALARM_MAX = 100;
export const LOCKDOWN_AT = 100;
export const ALARM_DECAY = 3.0; // per second while unseen
export const ALARM_RISE_GUARD = 34; // per second while a guard sees the thief
export const ALARM_RISE_CAMERA = 26; // per second while a camera sees the thief
export const ALARM_RISE_LASER = 40; // per second while crossing a laser beam

export const BUSTS = 3;
export const START_TOOLS = { smoke: 1, decoy: 1, emp: 0, cutter: 0, soles: 0, pick: 1 };

// Detection ranges (px). Sneaking shrinks the guard's effective cone.
export const GUARD_VIEW = 235;
export const GUARD_VIEW_SNEAK = 150;
export const CAMERA_VIEW = 210;
export const CONE_HALF_ANGLE = 0.46; // radians either side of facing

export const COLOURS = {
  floorA: '#2b2620',
  floorB: '#2e2921',
  carpet: '#5a2e35',
  carpetEdge: '#7a3b44',
  wall: '#171310',
  wallTop: '#4a3b2c',
  marble: '#3d342a',
  gold: '#f2c14e',
  goldDim: '#b98f2e',
  gemRed: '#e5484d',
  gemBlue: '#4da3ff',
  gemGreen: '#43d68a',
  guard: '#3f6fb5',
  guardElite: '#8a4fd0',
  guardDog: '#b5763f',
  runner: '#c94f6d',
  cone: 'rgba(255, 214, 90, 0.20)',
  coneSeen: 'rgba(255, 70, 60, 0.34)',
  camera: '#7fe3d0',
  laser: '#ff4d6d',
  thief: '#e8e4d8',
  thiefCloak: '#20242e',
  vent: '#6b7280',
  plant: '#2f6b3a',
  shadow: 'rgba(0,0,0,0.45)',
  hud: '#14100c',
  alarmLow: '#43d68a',
  alarmMid: '#f2c14e',
  alarmHigh: '#e5484d',
};
