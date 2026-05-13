# Live2D Avatar Asset Placeholder

Live2D avatar models are user files. Put them under:

```text
~/.ai-web-os/avatar/live2d/
```

The backend serves those files through `/api/v1/avatar/assets/...`, and the
frontend setting stores paths such as:

```text
/avatar/assets/live2d/my-model/my-model.model3.json
```

Supported entry points:

- A Cubism 3/4 `.model3.json` path.
- A `.zip` file containing exactly one `.model3.json` file and its referenced assets.

This project directory is only a placeholder kept for old local checkouts.

Avatar assets are not part of the AI-Web OS license. Only use models that
you are allowed to use, modify, and distribute.
