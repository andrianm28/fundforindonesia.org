import path from 'node:path';
import ts from 'typescript';

/**
 * Every place in `src` (tests and generated code excluded), and in any
 * `alsoScan` file outside it (the seed, say), that names one of `fields` on
 * the Prisma model `model`, as `file:line` relative to `root`.
 *
 * Resolved with the type checker rather than a text search, because a field
 * name such as `status` or `role` is also a column on other models, or an
 * ARIA attribute, and a row is often held in a variable not named after its
 * model. A name counts when it resolves to the model's field in the
 * generated Prisma client: a `where`, `select` or `data` key, or a property
 * read off a row (`row.field`, `row['field']`, or destructured). An
 * `omit: { field: true }` key does not count: it keeps the column out of a
 * result, the opposite of reading it. Not seen: raw SQL, `groupBy`'s
 * `by: ['field']`, and untyped JSON a browser reads back.
 *
 * Generated types are attributed to the model by name prefix (`Campaign`,
 * `CampaignSelect`, `$CampaignPayload`...), so the fields must belong to no
 * other model whose name starts with `model` (CampaignFlag, UserAssignment).
 *
 * Lives outside src/ so it is never mistaken for application code.
 */
export function findPrismaFieldReferences({
  model,
  fields,
  root = process.cwd(),
  alsoScan = [],
}: { model: string; fields: string[]; root?: string; alsoScan?: string[] }): string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(root, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!parsed) throw new Error('tsconfig.json could not be read');

  const alsoScanned = alsoScan.map((file) => path.join(root, file));
  const sources = parsed.fileNames.filter(
    (file) =>
      alsoScanned.includes(file) ||
      (file.includes('/src/') &&
        !file.includes('/src/generated/') &&
        !file.includes('/__tests__/') &&
        !/\.test\.tsx?$/.test(file)),
  );
  for (const file of alsoScanned) {
    if (!sources.includes(file)) throw new Error(`${path.relative(root, file)} is not part of the TypeScript project`);
  }
  const program = ts.createProgram(sources, { ...parsed.options, incremental: false, noEmit: true });
  const checker = program.getTypeChecker();
  const COMPLETIONS_CONTEXT = 4; // ts.ContextFlags.Completions
  const contextualTypeForCompletions = (node: ts.Expression) =>
    (checker.getContextualType as (node: ts.Expression, flags: number) => ts.Type | undefined)(
      node,
      COMPLETIONS_CONTEXT,
    );

  const isGenerated = (decl: ts.Declaration) => decl.getSourceFile().fileName.includes('/src/generated/');
  const MODEL_TYPE = new RegExp(`^\\$?${model}`);
  const OMIT_TYPE = new RegExp(`^${model}Omit$`);
  const fieldSet = new Set(fields);

  const ownerName = (decl: ts.Node): string => {
    for (let node = decl.parent; node; node = node.parent) {
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) {
        return node.name.text;
      }
    }
    return '';
  };
  const declaredOnModel = (symbol: ts.Symbol | undefined) =>
    (symbol?.declarations ?? []).some(
      (decl) => isGenerated(decl) && MODEL_TYPE.test(ownerName(decl)) && !OMIT_TYPE.test(ownerName(decl)),
    );
  // Prisma's select and omit types are mapped types whose properties carry
  // no declaration, so a key is attributed through the type it sits in.
  const isModelType = (type: ts.Type) =>
    [type.aliasSymbol, type.symbol].some(
      (symbol) =>
        symbol !== undefined &&
        MODEL_TYPE.test(symbol.name) &&
        !OMIT_TYPE.test(symbol.name) &&
        (symbol.declarations ?? []).some(isGenerated),
    );

  const sourceSet = new Set(sources);
  const hits: string[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceSet.has(sourceFile.fileName)) continue;

    const visit = (node: ts.Node) => {
      const name =
        ts.isIdentifier(node) ||
        // row['field']
        (ts.isStringLiteralLike(node) && ts.isElementAccessExpression(node.parent))
          ? (node as ts.Identifier | ts.StringLiteralLike).text
          : undefined;
      if (name !== undefined && fieldSet.has(name)) {
        let hit = declaredOnModel(checker.getSymbolAtLocation(node));
        const parent = node.parent;
        // const { field } = row, or const { field: f } = row: the name is
        // looked up on the type being destructured.
        if (!hit && ts.isBindingElement(parent) && (parent.propertyName ?? parent.name) === node) {
          const destructured = checker.getTypeAtLocation(parent.parent);
          const types = destructured.isUnion() ? destructured.types : [destructured];
          hit = types.some((type) => declaredOnModel(type.getProperty(name)));
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
            const property = type.getProperty(name);
            return property !== undefined && (isModelType(type) || declaredOnModel(property));
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
