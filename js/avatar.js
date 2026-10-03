/* ==========================================================================
   ZoopeAvatar — animates a captured face photo on a <canvas>.
   - Natural random blinking
   - Mouth opening driven by a 0..1 "openness" value (audio level or speech)

   Landmarks are relative to the face crop taken from the oval guide. In
   production these come from the face-mesh model on the Zoope backend; the
   defaults below match the guide's proportions.
   ========================================================================== */
(function () {
  const DEFAULT_LANDMARKS = {
    leftEye:  { x: 0.375, y: 0.445, w: 0.11, h: 0.045 },
    rightEye: { x: 0.625, y: 0.445, w: 0.11, h: 0.045 },
    mouth:    { x: 0.5,   y: 0.68,  w: 0.15 },
    skin:     { x: 0.32,  y: 0.56 },   // cheek, used to color eyelids
    lip:      { x: 0.5,   y: 0.70 }
  };

  class ZoopeAvatar {
    constructor(canvas, imageSrc, landmarks) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.lm = landmarks || DEFAULT_LANDMARKS;
      this.open = 0;          // smoothed mouth openness
      this.target = 0;        // requested openness
      this.blink = 0;         // 0 open .. 1 closed
      this.nextBlink = performance.now() + 1500;
      this.blinkStart = 0;
      this.levelFn = null;    // optional () => 0..1
      this.running = false;
      this.img = new Image();
      this.ready = new Promise(res => {
        this.img.onload = () => { this._sampleColors(); res(); };
      });
      this.img.src = imageSrc;
    }

    _sampleColors() {
      const c = document.createElement('canvas');
      c.width = this.img.width; c.height = this.img.height;
      const x = c.getContext('2d');
      x.drawImage(this.img, 0, 0);
      const px = (p) => {
        const d = x.getImageData(Math.floor(p.x * c.width) - 3, Math.floor(p.y * c.height) - 3, 6, 6).data;
        let r = 0, g = 0, b = 0, n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        return [r / n | 0, g / n | 0, b / n | 0];
      };
      this.skin = px(this.lm.skin);
      const lip = px(this.lm.lip);
      // Lips are usually a bit redder and darker than the sampled point
      this.lip = [Math.min(255, lip[0] * 0.85 + 30), lip[1] * 0.6, lip[2] * 0.6].map(v => v | 0);
    }

    setLevelSource(fn) { this.levelFn = fn; }
    setOpenness(v) { this.target = Math.max(0, Math.min(1, v)); }

    start() {
      if (this.running) return;
      this.running = true;
      this.ready.then(() => {
        const loop = (t) => {
          if (!this.running) return;
          this._tick(t);
          this._draw();
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
    }
    stop() { this.running = false; }

    _tick(t) {
      // Blinking: ~120ms close, ~120ms open, every 2.5–6s, sometimes double-blink
      if (t >= this.nextBlink && !this.blinkStart) this.blinkStart = t;
      if (this.blinkStart) {
        const e = t - this.blinkStart;
        this.blink = e < 110 ? e / 110 : e < 240 ? 1 - (e - 110) / 130 : 0;
        if (e >= 240) {
          this.blinkStart = 0;
          this.nextBlink = t + (Math.random() < 0.15 ? 180 : 2500 + Math.random() * 3500);
        }
      }
      const target = this.levelFn ? this.levelFn() : this.target;
      // Faster attack than release looks more like real speech
      const k = target > this.open ? 0.55 : 0.25;
      this.open += (target - this.open) * k;
    }

    _draw() {
      const { ctx, canvas: c, img, lm } = this;
      const W = c.width, H = c.height;
      // Cover-fit the face photo
      const s = Math.max(W / img.width, H / img.height);
      const dw = img.width * s, dh = img.height * s;
      const ox = (W - dw) / 2, oy = (H - dh) / 2;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, ox, oy, dw, dh);
      const X = (v) => ox + v * dw, Y = (v) => oy + v * dh;

      // Eyelids
      if (this.blink > 0.02) {
        const [r, g, b] = this.skin;
        for (const e of [lm.leftEye, lm.rightEye]) {
          const ew = e.w * dw, eh = e.h * dh;
          const cx = X(e.x), cy = Y(e.y);
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(cx, cy, ew / 2, eh, 0, 0, Math.PI * 2);
          ctx.clip();
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(cx - ew, cy - eh * 1.2, ew * 2, eh * 2.4 * this.blink);
          // lash line
          ctx.strokeStyle = 'rgba(40,25,20,.55)';
          ctx.lineWidth = Math.max(1.5, eh * 0.15);
          ctx.beginPath();
          const ly = cy - eh * 1.2 + eh * 2.4 * this.blink;
          ctx.moveTo(cx - ew / 2, ly); ctx.lineTo(cx + ew / 2, ly);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Mouth
      if (this.open > 0.03) {
        const mw = lm.mouth.w * dw * (1 - this.open * 0.15);
        const mh = (0.008 + this.open * 0.055) * dh;
        const cx = X(lm.mouth.x), cy = Y(lm.mouth.y);
        const [r, g, b] = this.lip;
        ctx.save();
        // lips
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath(); ctx.ellipse(cx, cy, mw / 2 + 3, mh / 2 + 4, 0, 0, Math.PI * 2); ctx.fill();
        // mouth interior
        ctx.fillStyle = '#2a0c10';
        ctx.beginPath(); ctx.ellipse(cx, cy, mw / 2, mh / 2, 0, 0, Math.PI * 2); ctx.fill();
        // teeth hint
        if (this.open > 0.35) {
          ctx.fillStyle = 'rgba(245,240,235,.9)';
          ctx.beginPath(); ctx.ellipse(cx, cy - mh * 0.32, mw * 0.36, mh * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  window.ZoopeAvatar = ZoopeAvatar;
  window.ZOOPE_DEFAULT_LANDMARKS = DEFAULT_LANDMARKS;
})();
