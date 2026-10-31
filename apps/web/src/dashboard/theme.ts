/**
 * AG Studio theme from NeedGrid's design tokens (docs/design-tokens.md, apps/web/src/styles/globals.css).
 * Values are CSS variables, so Studio follows the rest of the app if a token changes.
 */
import { studioTheme } from "ag-studio";

const token = (name: string) => `var(--${name})`;
const line = (name: string) => ({ width: 1, color: token(name) });

/** Ten chart colours, all from the token set: teal first (primary), warm accents after. */
const CHART_COLOURS = [
  "#0f766e", // --primary
  "#ea7a2e", // --accent
  "#15803d", // --success
  "#075985", // --badge-info-text
  "#b45309", // --warning
  "#99d5cf", // --held
  "#134e4a", // --staff-header
  "#c2410c", // --left-text
  "#6b6f76", // --muted
  "#b91c1c", // --danger
];

const palette = Object.fromEntries(
  CHART_COLOURS.flatMap((c, i) => [
    [`chartPaletteFills${i + 1}Color`, c],
    [`chartPaletteStrokes${i + 1}Color`, c],
  ]),
);

export const needGridStudioTheme = studioTheme.withParams({
  fontFamily: token("font-sans"),
  fontSize: 14,
  textColor: token("text"),
  foregroundColor: token("text"),
  subtleTextColor: token("muted"),
  backgroundColor: token("surface"),
  borderColor: token("border"),
  accentColor: token("primary"),
  iconColor: token("staff-header"),
  rowHoverColor: token("primary-soft"),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token("bg"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token("bg"),
  studioCanvasPadding: 16,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: token("font-sans"),

  // Widgets look like the app's cards: white, 1 px border, 12 px radius.
  studioWidgetBackgroundColor: token("surface"),
  studioWidgetBorder: line("border"),
  studioWidgetBorderRadius: 12,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: token("font-sans"),
  studioWidgetTitleFontSize: 16,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: token("text"),
  studioWidgetSubtitleFontFamily: token("font-sans"),
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token("muted"),
  studioWidgetCaptionFontFamily: token("font-sans"),
  studioWidgetCaptionFontSize: 13,
  studioWidgetCaptionTextColor: token("muted"),
  studioWidgetResizeBorderColor: token("primary"),

  studioPanelContainerBackgroundColor: token("surface"),
  studioPanelContainerBorder: line("border"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token("border"),
  studioPanelDividerActiveColor: token("primary"),
  studioPanelSectionBorderColor: token("border"),
  studioPanelHeaderFontFamily: token("font-sans"),
  studioPanelHeaderFontWeight: 700,
  studioPanelChevronButtonHoverBackgroundColor: token("primary-soft"),
  studioPanelChevronButtonHoverColor: token("primary"),
  studioToggleButtonActiveBackgroundColor: token("primary-soft"),
  studioToggleButtonActiveBorderColor: token("primary"),
  studioToggleButtonActiveColor: token("primary"),

  gridFontFamily: token("font-sans"),
  gridFontSize: 14,
  gridCellTextColor: token("text"),
  gridHeaderBackgroundColor: token("surface"),
  gridHeaderTextColor: token("muted"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 13,
  gridRowHeight: 40,
  gridRowBorder: line("track"),
  gridHeaderRowBorder: line("border"),
  gridPinnedRowBorder: line("border"),
  gridRowHoverColor: token("primary-soft"),
  gridWrapperBorder: false,

  chartFontFamily: token("font-sans"),
  chartTextColor: token("text"),
  chartSubtleTextColor: token("muted"),
  chartAxisLineColor: token("border"),
  chartGridLineColor: token("track"),
  ...palette,
});
