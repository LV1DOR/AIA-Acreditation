import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require(process.env.AIA_DIAG_TS_PATH ?? '/app/node_modules/typescript/lib/typescript.js');
function need(ok, code) { if (!ok) throw new Error(code); }
export function deriveRenderOnlyModule(source) {
  need(typeof source === 'string' && source.length > 0 && Buffer.byteLength(source) <= 32 * 1024 * 1024, 'BOUNDED_PUBLIC_WORKER_BUNDLE_REQUIRED');
  const tree = ts.createSourceFile('worker-public.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  need(tree.parseDiagnostics.length === 0, 'WORKER_BUNDLE_SYNTAX_INVALID');
  const final = tree.statements.at(-1);
  need(final && ts.isExpressionStatement(final) && ts.isCallExpression(final.expression), 'EXACT_WORKER_STARTUP_TAIL_REQUIRED');
  const call = final.expression;
  need(ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'catch', 'EXACT_WORKER_STARTUP_TAIL_REQUIRED');
  const startup = call.expression.expression;
  need(ts.isCallExpression(startup) && ts.isIdentifier(startup.expression) && /^main\d*$/.test(startup.expression.text) && startup.arguments.length === 0, 'EXACT_WORKER_STARTUP_TAIL_REQUIRED');
  const mainName = startup.expression.text;
  need(call.arguments.length === 1 && ts.isArrowFunction(call.arguments[0]) && ts.isBlock(call.arguments[0].body), 'EXACT_STARTUP_ERROR_HANDLER_REQUIRED');
  const handler = call.arguments[0].body.getText(tree).replace(/\s/g, '');
  need(/^\{logger\d*\.error\("STARTUP_FAILED"\);process\.exit\(1\);\}$/.test(handler), 'EXACT_STARTUP_ERROR_HANDLER_REQUIRED');
  need(tree.statements.filter(s => ts.isFunctionDeclaration(s) && s.name?.text === mainName).length === 1, 'EXACT_WORKER_MAIN_DECLARATION_REQUIRED');
  // Reject a second eager main() invocation or public exports that could start it.
  for (const statement of tree.statements.slice(0, -1)) {
    let unsafe = false;
    function walk(node) {
      if (ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === mainName) unsafe = true;
      ts.forEachChild(node, walk);
    }
    walk(statement);
    need(!unsafe && !ts.isExportAssignment(statement) && !ts.isExportDeclaration(statement), 'UNREVIEWED_EAGER_STARTUP_REFUSED');
  }
  const exports = ['renderBusinessEmail', 'prepareSmtpMessage', 'smtpTransportOptions'];
  for (const name of exports) need(tree.statements.filter(s => ts.isFunctionDeclaration(s) && s.name?.text === name).length === 1, 'EXACT_EMAIL_FUNCTION_DECLARATIONS_REQUIRED');
  return source.slice(0, final.getStart(tree)) + source.slice(final.getEnd()) + '\nexport { ' + exports.join(', ') + ' };\n';
}
export function sanitizedError(error) {
  const out = { code: 'STAGE_FAILED_DETAILS_SUPPRESSED' };
  const dynamic = /^Dynamic require of "([a-z:_/]+)" is not supported$/.exec(String(error?.message ?? ''));
  if (dynamic && ['stream', 'node:stream', 'util', 'node:util', 'buffer', 'node:buffer', 'events', 'node:events', 'async_hooks', 'node:async_hooks', 'crypto', 'node:crypto'].includes(dynamic[1])) {
    out.code = 'BUNDLED_ESM_DYNAMIC_REQUIRE_UNSUPPORTED'; out.builtin = dynamic[1];
  } else if (['BOUNDED_PUBLIC_WORKER_BUNDLE_REQUIRED', 'WORKER_BUNDLE_SYNTAX_INVALID', 'EXACT_WORKER_STARTUP_TAIL_REQUIRED', 'EXACT_STARTUP_ERROR_HANDLER_REQUIRED', 'EXACT_WORKER_MAIN_DECLARATION_REQUIRED', 'UNREVIEWED_EAGER_STARTUP_REFUSED', 'EXACT_EMAIL_FUNCTION_DECLARATIONS_REQUIRED', 'BRANDED_MESSAGE_PREPARATION_FAILED', 'REVIEWED_WORKER_SMTP_CONFIGURATION_REQUIRED', 'CLERK_PRODUCTION_RECIPIENT_LOOKUP_REQUIRED'].includes(error?.message)) out.code = error.message;
  else if (['EAUTH', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'ERR_MODULE_NOT_FOUND', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(error?.code)) out.code = error.code;
  if (Number.isInteger(error?.responseCode)) out.smtpResponseCode = error.responseCode;
  if (Number.isInteger(error?.status)) out.httpStatus = error.status;
  if (error?.name === 'ZodError') { out.code = 'MESSAGE_VALIDATION_FAILED'; out.fields = [...new Set((error.issues ?? []).flatMap(i => i.path ?? []).filter(p => ['to', 'from', 'subject', 'html', 'text', 'deliveryId', 'template', 'companyName', 'eventName', 'appUrl', 'deadline'].includes(p)))]; }
  return out;
}
