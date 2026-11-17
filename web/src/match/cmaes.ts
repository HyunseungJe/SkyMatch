// Plain CMA-ES (Hansen's (μ/μw, λ) with rank-one and rank-μ updates) on the unit box [0,1]^n.
// Bounded dims are clamped, periodic dims wrap. Written for this project; no external code.

export interface CmaOptions {
  /** Start point in [0,1]^n. */
  mean: number[];
  /** Initial step size in unit-box units. */
  sigma: number;
  /** Indices of dims that wrap around (angles). */
  periodic?: number[];
  /** Population size; default 4 + floor(3 ln n). */
  lambda?: number;
  seed?: number;
}

export interface Candidate {
  x: number[];
  loss: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Jacobi eigen-decomposition of a symmetric matrix: C = B diag(d) B^T. */
function eigen(C: number[][]): { B: number[][]; d: number[] } {
  const n = C.length;
  const A = C.map((row) => [...row]);
  const B = A.map((_, i) => A.map((__, j) => +(i === j)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-30) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const bkp = B[k][p], bkq = B[k][q];
          B[k][p] = c * bkp - s * bkq;
          B[k][q] = s * bkp + c * bkq;
        }
      }
    }
  }
  return { B, d: A.map((row, i) => Math.max(1e-20, row[i])) };
}

export class Cma {
  readonly n: number;
  readonly lambda: number;
  private readonly mu: number;
  private readonly weights: number[];
  private readonly mueff: number;
  private readonly cc: number;
  private readonly cs: number;
  private readonly c1: number;
  private readonly cmu: number;
  private readonly damps: number;
  private readonly chiN: number;
  private readonly periodic: Set<number>;
  private readonly random: () => number;
  mean: number[];
  sigma: number;
  private C: number[][];
  private B: number[][];
  private D: number[];
  private pc: number[];
  private ps: number[];
  private generation = 0;
  private eigenAt = 0;
  best: Candidate | null = null;

  constructor(options: CmaOptions) {
    const n = (this.n = options.mean.length);
    this.lambda = options.lambda ?? 4 + Math.floor(3 * Math.log(n));
    this.mu = Math.floor(this.lambda / 2);
    const raw = Array.from({ length: this.mu }, (_, i) => Math.log(this.mu + 0.5) - Math.log(i + 1));
    const sum = raw.reduce((a, b) => a + b, 0);
    this.weights = raw.map((w) => w / sum);
    this.mueff = 1 / this.weights.reduce((a, w) => a + w * w, 0);
    this.cc = (4 + this.mueff / n) / (n + 4 + (2 * this.mueff) / n);
    this.cs = (this.mueff + 2) / (n + this.mueff + 5);
    this.c1 = 2 / ((n + 1.3) ** 2 + this.mueff);
    this.cmu = Math.min(1 - this.c1, (2 * (this.mueff - 2 + 1 / this.mueff)) / ((n + 2) ** 2 + this.mueff));
    this.damps = 1 + 2 * Math.max(0, Math.sqrt((this.mueff - 1) / (n + 1)) - 1) + this.cs;
    this.chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
    this.periodic = new Set(options.periodic ?? []);
    this.random = rng(options.seed ?? 12345);
    this.mean = this.repair([...options.mean]);
    this.sigma = options.sigma;
    this.C = this.identity();
    this.B = this.identity();
    this.D = new Array(n).fill(1);
    this.pc = new Array(n).fill(0);
    this.ps = new Array(n).fill(0);
  }

  private identity(): number[][] {
    return Array.from({ length: this.n }, (_, i) => Array.from({ length: this.n }, (__, j) => +(i === j)));
  }

  private gauss(): number {
    return Math.sqrt(-2 * Math.log(Math.max(1e-12, this.random()))) * Math.cos(2 * Math.PI * this.random());
  }

  repair(x: number[]): number[] {
    return x.map((v, i) => (this.periodic.has(i) ? v - Math.floor(v) : Math.min(1, Math.max(0, v))));
  }

  /** Difference that respects wrapping dims. */
  private diff(a: number, b: number, i: number): number {
    const d = a - b;
    return this.periodic.has(i) ? d - Math.round(d) : d;
  }

  /** λ new points to evaluate. */
  ask(): number[][] {
    const out: number[][] = [];
    for (let k = 0; k < this.lambda; k++) {
      const z = Array.from({ length: this.n }, () => this.gauss());
      const y = this.B.map((row) => row.reduce((s, b, j) => s + b * Math.sqrt(this.D[j]) * z[j], 0));
      out.push(this.repair(this.mean.map((m, i) => m + this.sigma * y[i])));
    }
    return out;
  }

  /** Updates the distribution from evaluated points (any order). */
  tell(population: Candidate[]): void {
    const n = this.n;
    const sorted = [...population].sort((a, b) => a.loss - b.loss);
    if (!this.best || sorted[0].loss < this.best.loss) this.best = { x: [...sorted[0].x], loss: sorted[0].loss };
    const old = this.mean;
    const step = new Array(n).fill(0); // weighted mean of (x - old) / sigma
    for (let k = 0; k < this.mu; k++) for (let i = 0; i < n; i++) step[i] += (this.weights[k] * this.diff(sorted[k].x[i], old[i], i)) / this.sigma;
    this.mean = this.repair(old.map((m, i) => m + this.sigma * step[i]));
    // C^{-1/2} step = B D^{-1/2} B^T step
    const bt = this.B[0].map((_, j) => this.B.reduce((s, row, i) => s + row[j] * step[i], 0));
    const inv = this.B.map((row) => row.reduce((s, b, j) => s + (b * bt[j]) / Math.sqrt(this.D[j]), 0));
    const csn = Math.sqrt(this.cs * (2 - this.cs) * this.mueff);
    this.ps = this.ps.map((p, i) => (1 - this.cs) * p + csn * inv[i]);
    const psNorm = Math.hypot(...this.ps);
    this.generation++;
    const hsig = psNorm / Math.sqrt(1 - (1 - this.cs) ** (2 * this.generation)) / this.chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    const ccn = Math.sqrt(this.cc * (2 - this.cc) * this.mueff);
    this.pc = this.pc.map((p, i) => (1 - this.cc) * p + hsig * ccn * step[i]);
    const ys = sorted.slice(0, this.mu).map((c) => c.x.map((v, i) => this.diff(v, old[i], i) / this.sigma));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let rankMu = 0;
        for (let k = 0; k < this.mu; k++) rankMu += this.weights[k] * ys[k][i] * ys[k][j];
        const value =
          (1 - this.c1 - this.cmu) * this.C[i][j] +
          this.c1 * (this.pc[i] * this.pc[j] + (1 - hsig) * this.cc * (2 - this.cc) * this.C[i][j]) +
          this.cmu * rankMu;
        this.C[i][j] = this.C[j][i] = value;
      }
    }
    this.sigma = Math.min(0.6, this.sigma * Math.exp((this.cs / this.damps) * (psNorm / this.chiN - 1)));
    if (this.generation - this.eigenAt >= Math.max(1, Math.floor(1 / ((this.c1 + this.cmu) * n * 10)))) {
      const { B, d } = eigen(this.C);
      this.B = B;
      this.D = d;
      this.eigenAt = this.generation;
    }
  }
}
