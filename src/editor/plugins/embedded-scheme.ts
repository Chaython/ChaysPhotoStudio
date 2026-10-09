/**
 * A deliberately small, self-contained Scheme subset for pure calculations.
 * It has NO FFI, file access, network, GIMP PDB, JS eval or external modules.
 * Used only inside a fresh disposable Web Worker when explicitly requested.
 */
export function evaluateScheme(source: string): string {
  if (source.length > 64000) throw new Error('Scheme source exceeds 64 KB')
  const tokens: string[] = []
  const re = /\s+|;[^\n]*|"(?:\\.|[^"\\])*"|'|[()]|[^\s()'";]+/gy
  let cursor = 0
  while (cursor < source.length) {
    re.lastIndex = cursor
    const match = re.exec(source)
    if (!match) throw new Error('Unrecognized Scheme syntax near ' + cursor)
    if (!/^\s|^;/.test(match[0])) tokens.push(match[0])
    cursor = re.lastIndex
    if (tokens.length > 12000) throw new Error('Scheme token limit exceeded')
  }
  let pos = 0
  let count = 0
  const output: string[] = []
  type SymbolNode = { symbol: string }
  type LiteralNode = { text: string }
  type Value = number | string | boolean | Value[] | Callable | null
  type AST = number | boolean | SymbolNode | LiteralNode | AST[]
  type Callable = (...args: Value[]) => Value
  const sym = (x: string): SymbolNode => ({ symbol: x })
  const isSym = (x: AST): x is SymbolNode => typeof x === 'object' && x !== null && !Array.isArray(x) && 'symbol' in x
  const parse = (depth = 0): AST => {
    if (++count > 22000 || depth > 150) throw new Error('Scheme complexity limit exceeded')
    const token = tokens[pos++]
    if (token === undefined) throw new Error('Unexpected end of Scheme expression')
    if (token === ')') throw new Error('Unexpected )')
    if (token === "'") return [sym('quote'), parse(depth + 1)]
    if (token === '(') {
      const list: AST[] = []
      while (tokens[pos] !== ')') {
        if (pos >= tokens.length) throw new Error('Missing )')
        list.push(parse(depth + 1))
      }
      pos++
      return list
    }
    if (token.startsWith('"')) {
      try { return { text: JSON.parse(token) } }
      catch { throw new Error('Invalid Scheme string literal') }
    }
    if (token === '#t') return true
    if (token === '#f') return false
    if (token !== '' && Number.isFinite(Number(token))) return Number(token)
    return sym(token)
  }
  const program: AST[] = []
  while (pos < tokens.length) program.push(parse())
  class Scope {
    entries = new Map<string, Value>()
    constructor(public parent?: Scope) {}
    get(name: string): Value {
      if (this.entries.has(name)) return this.entries.get(name)!
      if (this.parent) return this.parent.get(name)
      throw new Error('Unbound Scheme symbol: ' + name + ' (GIMP PDB is unavailable in embedded mode)')
    }
    set(name: string, value: Value) {
      if (this.entries.has(name)) this.entries.set(name, value)
      else if (this.parent) this.parent.set(name, value)
      else throw new Error('Unbound Scheme variable: ' + name)
    }
  }
  let steps = 0
  const tick = () => { if (++steps > 20000) throw new Error('Scheme operation limit exceeded') }
  const printable = (value: Value): string =>
    Array.isArray(value) ? '(' + value.map(printable).join(' ') + ')' :
    typeof value === 'boolean' ? (value ? '#t' : '#f') :
    typeof value === 'function' ? '#<procedure>' : value === null ? '()' : String(value)
  const truth = (v: Value) => v !== false
  const quote = (node: AST): Value => {
    if (isSym(node)) return node.symbol
    if (Array.isArray(node)) return node.map(quote)
    if (typeof node === 'object' && node !== null && 'text' in node) return node.text
    return node
  }
  const evalNode = (node: AST, scope: Scope): Value => {
    tick()
    if (isSym(node)) return scope.get(node.symbol)
    if (!Array.isArray(node)) {
      if (typeof node === 'object' && node !== null && 'text' in node) return node.text
      return node
    }
    if (!node.length) return []
    const head = node[0]
    const special = isSym(head) ? head.symbol : ''
    if (special === 'quote') { if (node.length !== 2) throw new Error('quote expects one argument'); return quote(node[1]) }
    if (special === 'if') return truth(evalNode(node[1], scope)) ? evalNode(node[2], scope) : node[3] === undefined ? null : evalNode(node[3], scope)
    if (special === 'begin') { let last: Value = null; for (const expression of node.slice(1)) last = evalNode(expression, scope); return last }
    if (special === 'define') {
      if (!isSym(node[1])) throw new Error('define expects a symbol')
      const value = evalNode(node[2], scope)
      scope.entries.set(node[1].symbol, value)
      return value
    }
    if (special === 'set!') {
      if (!isSym(node[1])) throw new Error('set! expects a symbol')
      const value = evalNode(node[2], scope); scope.set(node[1].symbol, value); return value
    }
    if (special === 'and') {
      let result: Value = true
      for (const expression of node.slice(1)) { result = evalNode(expression, scope); if (!truth(result)) return result }
      return result
    }
    if (special === 'or') {
      for (const expression of node.slice(1)) { const v = evalNode(expression, scope); if (truth(v)) return v }
      return false
    }
    if (special === 'lambda') {
      const params = node[1]
      if (!Array.isArray(params) || !params.every(isSym)) throw new Error('lambda expects a parameter list')
      const names = params.map(p => (p as SymbolNode).symbol)
      return (...values: Value[]): Value => {
        if (values.length !== names.length) throw new Error('Scheme arity mismatch')
        const child = new Scope(scope)
        names.forEach((name, i) => child.entries.set(name, values[i]))
        let result: Value = null
        for (const part of node.slice(2)) result = evalNode(part, child)
        return result
      }
    }
    if (special === 'let') {
      const bindings = node[1]
      if (!Array.isArray(bindings)) throw new Error('let expects bindings')
      const child = new Scope(scope)
      for (const item of bindings) {
        if (!Array.isArray(item) || item.length !== 2 || !isSym(item[0])) throw new Error('Invalid let binding')
        child.entries.set(item[0].symbol, evalNode(item[1], scope))
      }
      let result: Value = null
      for (const part of node.slice(2)) result = evalNode(part, child)
      return result
    }
    const fn = evalNode(head, scope)
    if (typeof fn !== 'function') throw new Error('Scheme expression is not callable')
    return fn(...node.slice(1).map(x => evalNode(x, scope)))
  }
  const global = new Scope()
  const nums = (args: Value[]) => args.map(v => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Expected numeric Scheme argument')
    return v
  })
  const register = (name: string, fn: Callable) => global.entries.set(name, fn)
  register('+', (...v) => nums(v).reduce((a,b) => a+b, 0))
  register('*', (...v) => nums(v).reduce((a,b) => a*b, 1))
  register('-', (...v) => { const n=nums(v); if(!n.length)throw new Error('- requires arguments'); return n.length===1?-n[0]:n.slice(1).reduce((a,b)=>a-b,n[0]) })
  register('/', (...v) => { const n=nums(v); if(!n.length)throw new Error('/ requires arguments'); const out=n.slice(1).reduce((a,b)=>a/b,n[0]); if(!Number.isFinite(out))throw new Error('Nonfinite Scheme result'); return out })
  for (const [name, comparator] of [['=', (a: number,b: number)=>a===b],['<',(a: number,b: number)=>a<b],['>',(a: number,b: number)=>a>b],['<=',(a: number,b: number)=>a<=b],['>=',(a: number,b: number)=>a>=b]] as const) {
    register(name, (...v) => { const n=nums(v); return n.slice(1).every((x,i)=>comparator(n[i],x)) })
  }
  register('list', (...v) => v)
  register('cons', (a,b) => { if(!Array.isArray(b))throw new Error('cons expects list'); return [a,...b] })
  register('car', (a) => { if(!Array.isArray(a)||!a.length)throw new Error('car expects nonempty list'); return a[0] })
  register('cdr', (a) => { if(!Array.isArray(a)||!a.length)throw new Error('cdr expects nonempty list'); return a.slice(1) })
  register('length', (a) => { if(!Array.isArray(a))throw new Error('length expects list'); return a.length })
  register('not', a => a === false)
  register('display', a => { output.push(printable(a)); return null })
  register('newline', () => { output.push('\n'); return null })
  let final: Value = null
  for (const expr of program) final = evalNode(expr, global)
  const printed = output.join('')
  return (printed + (final !== null ? (printed && !printed.endsWith('\n') ? '\n' : '') + printable(final) : '')).slice(0,20000)
}
