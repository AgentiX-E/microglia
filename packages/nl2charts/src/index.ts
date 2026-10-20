/**
 * `@agentix-e/microglia-nl2charts` — the reference domain pack.
 *
 * The pack is small on purpose. It demonstrates the contract a host must
 * implement (canonicalise, validate, classify an edit, describe a scoped
 * lesson) without shipping a charting library or a SQL engine. Everything that
 * is product-specific about nl2charts lives here; everything that is general
 * about learning from feedback lives in core.
 */
export {
  CHART_MARKS,
  DOMAINS,
  assertChartSpec,
  canonicalChart,
  chartEditDistance,
  classifyChartEdit,
  constraintMatches,
  describeChartEdit,
  domainByName,
  fieldsWithRole,
  isChartSpec,
  renderConstraint,
  validateChartSpec,
  type Aggregate,
  type ChartConstraint,
  type ChartEdit,
  type ChartIntent,
  type ChartLesson,
  type ChartMark,
  type ChartSpec,
  type ChartViolation,
  type DomainSchema,
  type EditCode,
  type FieldDef,
  type FieldRole,
  type QueryFeatures,
} from './chart.js';

export { chartInterpreter, featuresOf, type ChartInterpretContext } from './interpret.js';
