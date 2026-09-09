// Trusted checker code runs in a short-lived child; plugin source is parsed, never imported.
export const typecheckProgram = String.raw`
import { isBuiltin } from 'node:module';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const { source, compilerUrl, typeRoot } = JSON.parse(raw);
const { default: ts } = await import(compilerUrl);
const filename = '/__eden_plugin__/index.mts';
const file = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2023, true);
if (file.referencedFiles.length || file.typeReferenceDirectives.length || file.libReferenceDirectives.length || file.hasNoDefaultLib) {
  throw new Error('Plugin source cannot load compiler reference directives');
}
function checkSpecifier(value) {
  if (!value || !ts.isStringLiteral(value) || !value.text.startsWith('node:') || !isBuiltin(value.text)) {
    throw new Error('Plugins may import only explicit node: built-in modules');
  }
}
function visit(node) {
  if (ts.isImportEqualsDeclaration(node)) throw new Error('Plugin import assignments are not supported');
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    if (node.moduleSpecifier) checkSpecifier(node.moduleSpecifier);
  }
  if (ts.isImportTypeNode(node)) checkSpecifier(node.argument.literal);
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) checkSpecifier(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(file);
const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: ['node'], typeRoots: [typeRoot] };
const host = ts.createCompilerHost(options);
const readSource = host.getSourceFile.bind(host);
host.getSourceFile = (name, ...args) => name === filename ? file : readSource(name, ...args);
const program = ts.createProgram([filename], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error);
const symbol = program.getTypeChecker().getSymbolAtLocation(file);
const exports = symbol ? program.getTypeChecker().getExportsOfModule(symbol) : [];
const handler = exports.find(item => item.name === 'default');
if (!handler) throw new Error('Plugin requires a default exported handler');
const handlerType = program.getTypeChecker().getTypeOfSymbolAtLocation(handler, file);
if (!handlerType.getCallSignatures().length) throw new Error('Plugin default export must be callable');
const errors = diagnostics.slice(0, 20).map(item => {
  const line = item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start).line + 1 : 0;
  return 'line ' + line + ': ' + ts.flattenDiagnosticMessageText(item.messageText, ' ');
});
process.stdout.write(JSON.stringify({ errors }));
`
