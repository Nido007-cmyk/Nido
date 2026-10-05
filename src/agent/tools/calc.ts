/**
 * calc.ts — NIDO: evaluador determinista de expresiones aritméticas.
 *
 * Puro y testeable. NUNCA usa eval() ni Function(): un parser propio
 * (descenso recursivo) garantiza que solo se ejecuten operaciones
 * matemáticas, sin escape al runtime.
 */

export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalcError";
  }
}

type Token =
  | { kind: "num"; value: number }
  | { kind: "op"; op: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "ident"; name: string }
  | { kind: "comma" };

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: (x) => {
    if (x < 0) throw new CalcError("sqrt de número negativo");
    return Math.sqrt(x);
  },
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: (x) => {
    if (x <= 0) throw new CalcError("ln de número no positivo");
    return Math.log(x);
  },
  log: (x) => {
    if (x <= 0) throw new CalcError("log de número no positivo");
    return Math.log10(x);
  },
  exp: Math.exp,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      let dots = 0;
      while (j < input.length && /[0-9.]/.test(input[j])) {
        if (input[j] === ".") dots++;
        j++;
      }
      if (dots > 1) throw new CalcError(`número malformado cerca de «${input.slice(i, j)}»`);
      const value = Number(input.slice(i, j));
      if (!Number.isFinite(value)) throw new CalcError(`número inválido «${input.slice(i, j)}»`);
      tokens.push({ kind: "num", value });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++;
      tokens.push({ kind: "ident", name: input.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ("+-*/%^".includes(ch)) {
      tokens.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i++;
      continue;
    }
    throw new CalcError(`carácter no permitido: «${ch}»`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos++];
    if (!t) throw new CalcError("expresión incompleta");
    return t;
  }

  parse(): number {
    const value = this.parseExpr();
    if (this.pos < this.tokens.length) {
      throw new CalcError("sobran símbolos al final de la expresión");
    }
    return value;
  }

  // expr := term (("+"|"-") term)*
  private parseExpr(): number {
    let value = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.op === "+" || t.op === "-")) {
        this.next();
        const rhs = this.parseTerm();
        value = t.op === "+" ? value + rhs : value - rhs;
      } else return value;
    }
  }

  // term := factor (("*"|"/"|"%") factor)*
  private parseTerm(): number {
    let value = this.parseFactor();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.op === "*" || t.op === "/" || t.op === "%")) {
        this.next();
        const rhs = this.parseFactor();
        if (t.op === "*") value *= rhs;
        else if (t.op === "/") {
          if (rhs === 0) throw new CalcError("división entre cero");
          value /= rhs;
        } else {
          if (rhs === 0) throw new CalcError("módulo entre cero");
          value %= rhs;
        }
      } else return value;
    }
  }

  // factor := unary ("^" factor)?   — ^ asocia a la derecha
  private parseFactor(): number {
    const base = this.parseUnary();
    const t = this.peek();
    if (t?.kind === "op" && t.op === "^") {
      this.next();
      return Math.pow(base, this.parseFactor());
    }
    return base;
  }

  // unary := "-" unary | primary
  private parseUnary(): number {
    const t = this.peek();
    if (t?.kind === "op" && (t.op === "-" || t.op === "+")) {
      this.next();
      const value = this.parseUnary();
      return t.op === "-" ? -value : value;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const t = this.next();
    if (t.kind === "num") return t.value;
    if (t.kind === "lparen") {
      const value = this.parseExpr();
      const closing = this.next();
      if (closing.kind !== "rparen") throw new CalcError("falta cerrar un paréntesis");
      return value;
    }
    if (t.kind === "ident") {
      const fn = FUNCTIONS[t.name];
      const constant = CONSTANTS[t.name];
      if (fn) {
        const open = this.next();
        if (open.kind !== "lparen") throw new CalcError(`«${t.name}» necesita paréntesis: ${t.name}(x)`);
        const arg = this.parseExpr();
        const close = this.next();
        if (close.kind !== "rparen") throw new CalcError("falta cerrar un paréntesis");
        return fn(arg);
      }
      if (constant !== undefined) return constant;
      throw new CalcError(`función o constante desconocida: «${t.name}»`);
    }
    throw new CalcError("expresión malformada");
  }
}

/**
 * Evalúa una expresión aritmética. Lanza CalcError con mensaje en español
 * si la expresión es inválida. Ejemplos: "2+3*4", "(15%+8%)*1200",
 * "sqrt(16)", "2^10", "sin(pi/2)".
 */
export function evaluateExpression(input: string): number {
  const expr = input.trim();
  if (!expr) throw new CalcError("expresión vacía");
  if (expr.length > 200) throw new CalcError("expresión demasiado larga");
  const value = new Parser(tokenize(expr)).parse();
  if (!Number.isFinite(value)) throw new CalcError("resultado no finito");
  return value;
}

/** Formatea un número para mostrarlo: recorta decimales flotantes. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // 10 decimales significativos como máximo, sin ceros de relleno.
  return String(Number(value.toFixed(10)));
}
