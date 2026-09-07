/* Restricted gravitational encounter: two softened galaxy potentials and massless stars.
 * Core drag approximates energy transfer to dark-matter halos. Stars are collisionless:
 * no particle damping, artificial explosions, or prescribed tidal-tail paths.
 * Units and elapsed time are illustrative, not a calibrated astrophysical prediction.
 */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GalaxyDynamics = api;
})(typeof window === "undefined" ? globalThis : window, () => {
  "use strict";

  const STEP = 1 / 120;
  const SOFTENING = 0.25;
  const DURATION = 12;

  function acceleration(x, y, z, cores) {
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (const core of cores) {
      const dx = core.x - x;
      const dy = core.y - y;
      const dz = core.z - z;
      const squared = dx * dx + dy * dy + dz * dz + SOFTENING * SOFTENING;
      const force = core.mass / (squared * Math.sqrt(squared));
      ax += dx * force;
      ay += dy * force;
      az += dz * force;
    }
    return [ax, ay, az];
  }

  class Encounter {
    constructor(primary, companion) {
      this.cores = [
        { x: -1.4, y: -0.25, z: 0, vx: 0.11, vy: -0.2, vz: 0, mass: 1 },
        { x: 1.4, y: 0.25, z: 0, vx: -0.11, vy: 0.2, vz: 0, mass: 1 }
      ];
      this.time = 0;
      this.accumulator = 0;
      this.particles = [];
      [primary, companion].forEach((seeds, galaxy) => {
        const core = this.cores[galaxy];
        const scale = galaxy === 0 ? 0.9 : 0.7;
        const tilt = galaxy === 0 ? 0.12 : -0.48;
        seeds.forEach((seed) => {
          const radius = Math.max(0.06, seed.radius * scale);
          const angle = seed.angle;
          const speed = Math.sqrt(core.mass * radius * radius / Math.pow(radius * radius + SOFTENING * SOFTENING, 1.5));
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const spin = seed.spin === -1 ? -1 : 1;
          const vx = -Math.sin(angle) * speed * spin;
          const vy = Math.cos(angle) * speed * spin;
          this.particles.push({
            x: core.x + x, y: core.y + y * Math.cos(tilt), z: y * Math.sin(tilt),
            vx: core.vx + vx, vy: core.vy + vy * Math.cos(tilt), vz: vy * Math.sin(tilt),
            galaxy
          });
        });
      });
    }

    get separation() {
      const [a, b] = this.cores;
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }

    get phase() {
      if (this.time >= DURATION) return "remnant";
      if (this.time >= 8) return "coalescence";
      if (this.time >= 4.8) return "tidal-tails";
      if (this.separation < 1.15) return "first-passage";
      return "approach";
    }

    kick(dt) {
      // Symmetric drag preserves the core pair's center of mass and momentum.
      const [a, b] = this.cores;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const squared = dx * dx + dy * dy;
      const denominator = Math.pow(squared + SOFTENING * SOFTENING, 1.5);
      const friction = 0.45 / (1 + Math.pow(Math.sqrt(squared) / 1.5, 4));
      const ax = dx / denominator + friction * (b.vx - a.vx) / 2;
      const ay = dy / denominator + friction * (b.vy - a.vy) / 2;
      // Stars use the instantaneous potentials; they exchange no momentum with one another.
      for (const star of this.particles) {
        const [sx, sy, sz] = acceleration(star.x, star.y, star.z, this.cores);
        star.vx += sx * dt;
        star.vy += sy * dt;
        star.vz += sz * dt;
      }
      a.vx += ax * dt;
      a.vy += ay * dt;
      b.vx -= ax * dt;
      b.vy -= ay * dt;
    }

    step() {
      this.kick(STEP / 2);
      for (const body of this.cores) {
        body.x += body.vx * STEP;
        body.y += body.vy * STEP;
        body.z += body.vz * STEP;
      }
      for (const star of this.particles) {
        star.x += star.vx * STEP;
        star.y += star.vy * STEP;
        star.z += star.vz * STEP;
      }
      this.kick(STEP / 2);
      this.time += STEP;
    }

    advance(seconds) {
      // A suspended tab must not queue minutes of physics on the next frame.
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      this.accumulator += Math.min(seconds, 0.1);
      let steps = 0;
      while (this.accumulator + 1e-10 >= STEP && steps < 12) {
        this.step();
        this.accumulator = Math.max(0, this.accumulator - STEP);
        steps += 1;
      }
    }
  }

  return Object.freeze({ Encounter, acceleration, duration: DURATION, step: STEP });
});
