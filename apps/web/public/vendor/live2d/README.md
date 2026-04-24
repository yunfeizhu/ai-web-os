# Live2D Runtime Vendor Files

`pixi-live2d-display/cubism4` requires Live2D Cubism Core at runtime.

For local development, place the runtime file here:

```text
apps/web/public/vendor/live2d/live2dcubismcore.min.js
```

The binary runtime is governed by the Live2D SDK license and is not committed
to this repository.

If this file is missing, the desktop companion stays available as a static/chat
entry and shows a runtime warning later.
