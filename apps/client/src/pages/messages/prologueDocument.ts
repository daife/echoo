import { buildPageZoomGestureGuardScript } from "../../shared/utils/pageZoom";

export function buildPrologueDocument(html: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <style>
      html,
      body {
        margin: 0;
        min-height: 100%;
        touch-action: pan-x pan-y;
        background: transparent;
        color: #f5f1ee;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body {
        overflow-x: hidden;
      }

      img,
      video,
      canvas,
      svg {
        max-width: 100%;
      }
    </style>
    <script>${buildPageZoomGestureGuardScript()}</script>
  </head>
  <body>${html}</body>
</html>`;
}
