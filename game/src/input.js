// Keyboard + mouse input, read once per frame into a plain object the world steps.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, clicked: false };
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.key)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.key.toLowerCase());
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
      this.mouse.y = ((e.clientY - r.top) / r.height) * canvas.height;
    });
    canvas.addEventListener('mousedown', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
      this.mouse.y = ((e.clientY - r.top) / r.height) * canvas.height;
      this.mouse.clicked = true;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.pressed.clear(); });
  }

  read() {
    const k = this.keys;
    const state = {
      up: k.has('w') || k.has('arrowup'),
      down: k.has('s') || k.has('arrowdown'),
      left: k.has('a') || k.has('arrowleft'),
      right: k.has('d') || k.has('arrowright'),
      sneak: k.has('shift'),
      run: false,
      interact: k.has('e'),
      mouseX: this.mouse.x,
      mouseY: this.mouse.y,
      mouseClicked: this.mouse.clicked,
    };
    this.mouse.clicked = false;
    return state;
  }

  wasPressed(key) { return this.pressed.has(key.toLowerCase()); }
  endFrame() { this.pressed.clear(); }
}
