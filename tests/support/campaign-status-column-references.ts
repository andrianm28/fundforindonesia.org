import path from 'node:path';
import ts from 'typescript';

/**
 * Every place in `src` (tests and generated code excluded) that names the
 * legacy Campaign `status` column, as `file:line`.
 *
 * Resolved with the type checker rather than a text search, because `status`
 * is also a column on Payments, Refunds, Payouts, VolunteerTrips and more,
 * and a Campaign row is often held in a variable not called `campaign`. A
 * `status` counts when it resolves to the Campaign model's field in the
 * generated Prisma client: a `where`, `select` or `data` key, or a property
 * read off a Campaign row (`row.status`, `row['status']`, or destructured).
 * An `omit: { status: true }` key does not count: it keeps the column out
 * of a result, the opposite of reading it. Not seen: raw SQL, `groupBy`'s
 * `by: ['status']`, and untyped JSON a browser reads back.
 *
 * Lives outside src/ so it is never mistaken for application code.
 */
export function findCampaignStatusReferences(root = process.cwd()): string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(root, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!parsed) throw new Error('tsconfig.json could not be read');

  const sources = parsed.fileNames.filter(
    (file) =>
      file.includes('/src/') &&
      !file.includes('/src/generated/') &&
      !file.includes('/__tests__/') &&
      !/\.test\.tsx?$/.test(file),
  );
  const program = ts.createProgram(sources, { ...parsed.options, incremental: false, noEmit: true });
  const checker = program.getTypeChecker();
  const COMPLETIONS_CONTEXT = 4; // ts.ContextFlags.Completions
  const contextualTypeForCompletions = (node: ts.Expression) =>
    (checker.getContextualType as (node: ts.Expression, flags: number) => ts.Type | undefined)(
      node,
      COMPLETIONS_CONTEXT,
    );

  const isGenerated = (decl: ts.Declaration) => decl.getSourceFile().fileName.includes('/src/generated/');
  // Only the Campaign model among the Campaign* models has a `status`
  // field, so a generated type named Campaign* that has one is Campaign's.
  const CAMPAIGN_TYPE = /^\$?Campaign/;
  const OMIT_TYPE = /^CampaignOmit$/;

  const ownerName = (decl: ts.Node): string => {
    for (let node = decl.parent; node; node = node.parent) {
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) {
        return node.name.text;
      }
    }
    return '';
  };
  const declaredOnCampaign = (symbol: ts.Symbol | undefined) =>
    (symbol?.declarations ?? []).some(
      (decl) => isGenerated(decl) && CAMPAIGN_TYPE.test(ownerName(decl)) && !OMIT_TYPE.test(ownerName(decl)),
    );
  // Prisma's select and omit types are mapped types whose properties carry
  // no declaration, so a key is attributed through the type it sits in.
  const isCampaignType = (type: ts.Type) =>
    [type.aliasSymbol, type.symbol].some(
      (symbol) =>
        symbol !== undefined &&
        CAMPAIGN_TYPE.test(symbol.name) &&
        !OMIT_TYPE.test(symbol.name) &&
        (symbol.declarations ?? []).some(isGenerated),
    );

  const sourceSet = new Set(sources);
  const hits: string[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceSet.has(sourceFile.fileName)) continue;

    const visit = (node: ts.Node) => {
      const named =
        (ts.isIdentifier(node) && node.text === 'status') ||
        // row['status']
        (ts.isStringLiteralLike(node) && node.text === 'status' && ts.isElementAccessExpression(node.parent));
      if (named) {
        let hit = declaredOnCampaign(checker.getSymbolAtLocation(node));
        const parent = node.parent;
        // const { status } = row, or const { status: s } = row: the name is
        // looked up on the type being destructured.
        if (!hit && ts.isBindingElement(parent) && (parent.propertyName ?? parent.name) === node) {
          const destructured = checker.getTypeAtLocation(parent.parent);
          const types = destructured.isUnion() ? destructured.types : [destructured];
          hit = types.some((type) => declaredOnCampaign(type.getProperty('status')));
        }
        if (
          !hit &&
          (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) &&
          parent.name === node
        ) {
          // Asked as the editor's completions would ask: the declared
          // parameter type, not the literal a generic call inferred from
          // this very object. The flag is internal to TypeScript, hence
          // the cast.
          const contextual = contextualTypeForCompletions(parent.parent);
          const types = !contextual ? [] : contextual.isUnion() ? contextual.types : [contextual];
          hit = types.some((type) => {
            const property = type.getProperty('status');
            return property !== undefined && (isCampaignType(type) || declaredOnCampaign(property));
          });
        }
        if (hit) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          hits.push(`${path.relative(root, sourceFile.fileName)}:${line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return hits.sort();
}
