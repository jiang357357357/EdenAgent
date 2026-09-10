import ts from 'typescript'
import path from 'node:path'

const functionKinds = new Set([
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
])
const branchKinds = new Set([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause, ts.SyntaxKind.CatchClause, ts.SyntaxKind.ConditionalExpression,
])
const branchOperators = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
])

function complexity(body) {
  let count = 1
  function visit(node) {
    if (functionKinds.has(node.kind)) return
    if (branchKinds.has(node.kind)) count++
    if (ts.isBinaryExpression(node) && branchOperators.has(node.operatorToken.kind)) count++
    ts.forEachChild(node, visit)
  }
  visit(body)
  return count
}

export function inspectSource(file, content, policy) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true)
  const errors = source.parseDiagnostics.map(diagnostic => `syntax: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
  const warnings = []
  const imports = []
  const lines = content.trimEnd().split('\n').length
  const isTest = file.includes('/tests/') || file.endsWith('.test.ts')
  if (lines > policy.maximumLines) errors.push(`file has ${lines} lines (max ${policy.maximumLines})`)
  else if (lines > policy.warningLines) warnings.push(`file has ${lines} lines`)
  if (path.basename(file) === 'index.ts') {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) {
        errors.push('index.ts must contain only imports and explicit exports')
      } else if (ts.isExportDeclaration(statement) && !statement.exportClause) {
        errors.push('index.ts cannot use export *')
      }
    }
  }
  if (/\/(utils|common|manager|part\d+)\.ts$/.test(file)) errors.push('name the file by its responsibility')
  function visit(node) {
    if (functionKinds.has(node.kind) && node.body) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      const end = source.getLineAndCharacterOfPosition(node.end).line + 1
      if (!isTest && end - start + 1 > policy.warningFunctionLines) warnings.push(`line ${start}: long function (${end - start + 1} lines)`)
      const score = complexity(node.body)
      if (!isTest && score > policy.maximumComplexity) errors.push(`line ${start}: complexity ${score} exceeds ${policy.maximumComplexity}`)
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteral(argument)) imports.push(argument.text)
      else errors.push('computed module loading requires an explicit reviewed architecture exception')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { errors, warnings, imports }
}
